/**
 * Survival policy — prioritizes staying alive.
 *
 * Behaviors:
 *   - Avoids dense enemy clusters by fleeing away from highest-threat sector
 *   - Kites enemies: attacks while retreating
 *   - Maintains safe distance when possible, but closes to weapon range to attack
 *   - Collects nearby pickups opportunistically
 *   - Avoids world edges
 *
 * Fully parameterized for evolution/tuning.
 */

import { registerPolicy } from '../policy-types.js';

const DEFAULT_PARAMS = {
  // Movement
  dangerRadius: 45,        // flee if enemy closer than this
  engageRadius: 150,       // approach if no enemies within this
  meleeEngageRadius: 55,   // for melee weapons: get this close to attack
  rangedEngageRadius: 120, // for ranged weapons: preferred attack distance
  edgeAvoidDist: 100,      // start pushing away from walls at this distance
  edgeAvoidWeight: 1.5,    // how strongly to avoid edges

  // Threat response
  fleeWeight: 1.0,         // weight for fleeing from danger
  kiteWeight: 0.6,         // perpendicular movement while attacking
  threatSectorWeight: 0.8, // bias away from high-threat sectors
  densityFleeThreshold: 4, // flee if more than this many enemies nearby

  // Pickups
  pickupGreed: 0.3,        // how much to bias toward pickups (0-1)
  pickupMaxDist: 200,      // ignore pickups further than this

  // Attack
  attackMinEnemies: 1,     // need at least this many enemies in arc to swing
  attackMaxDist: 1.1,      // attack if nearest enemy within weaponRange * this

  // Upgrade preferences (weights for categories)
  upgradePrefs: {
    survivability: 1.5,  // hp, armor, regen, heal
    damage: 0.5,         // damage multipliers
    aoe: 0.8,            // area damage, shockwave
    speed: 1.2,          // movement speed
    utility: 0.7,        // pickup radius, etc
  },
};

function createSurvivalPolicy(overrides = {}) {
  const params = { ...DEFAULT_PARAMS, ...overrides };
  if (overrides.upgradePrefs) {
    params.upgradePrefs = { ...DEFAULT_PARAMS.upgradePrefs, ...overrides.upgradePrefs };
  }

  // Internal state
  let tickCount = 0;
  let lastMoveAngle = 0;

  function getPreferredDist(obs) {
    const w = obs.weapon;
    if (w === 'sword') return params.meleeEngageRadius;
    return params.rangedEngageRadius;
  }

  return {
    name: 'Survival',
    id: 'survival',
    params,

    reset() {
      tickCount = 0;
      lastMoveAngle = 0;
    },

    act(obs) {
      tickCount++;
      let dx = 0;
      let dy = 0;

      const preferredDist = getPreferredDist(obs);
      const hasEnemy = obs.nearestEnemyDist < 500;

      if (hasEnemy) {
        const eDx = obs.nearestEnemyX - obs.playerX;
        const eDy = obs.nearestEnemyY - obs.playerY;
        const eDist = obs.nearestEnemyDist || 1;
        const normX = eDx / eDist;
        const normY = eDy / eDist;

        if (obs.nearEnemyCount >= params.densityFleeThreshold) {
          // High density: flee toward safest gap (stable, won't oscillate)
          dx = obs.safestDirX * params.fleeWeight;
          dy = obs.safestDirY * params.fleeWeight;
        } else if (eDist < params.dangerRadius) {
          // Too close — flee toward safest direction
          dx = obs.safestDirX * params.fleeWeight * 0.6 - normX * params.fleeWeight * 0.4;
          dy = obs.safestDirY * params.fleeWeight * 0.6 - normY * params.fleeWeight * 0.4;
        } else if (eDist > params.engageRadius) {
          // Too far — approach
          dx = normX * 0.7;
          dy = normY * 0.7;
        } else if (eDist > preferredDist * 1.2) {
          // Outside preferred range — close the gap
          dx = normX * 0.6;
          dy = normY * 0.6;
        } else if (eDist < preferredDist * 0.6) {
          // Inside preferred range — back off while kiting
          const perpX = -normY;
          const perpY = normX;
          dx = -normX * 0.4 + perpX * params.kiteWeight;
          dy = -normY * 0.4 + perpY * params.kiteWeight;
        } else {
          // In sweet spot — orbit/kite
          const perpX = -normY;
          const perpY = normX;
          const radialBias = (eDist - preferredDist) / preferredDist * 0.3;
          dx = perpX * params.kiteWeight + normX * radialBias;
          dy = perpY * params.kiteWeight + normY * radialBias;
        }

        // Bias away from highest-threat sector
        const threatDir = getMaxThreatDirection(obs);
        dx -= threatDir.x * params.threatSectorWeight * 0.3;
        dy -= threatDir.y * params.threatSectorWeight * 0.3;
      }

      // Opportunistic pickup collection
      if (obs.nearestPickupDist < params.pickupMaxDist && obs.nearEnemyCount < 3) {
        const pDx = obs.nearestPickupX - obs.playerX;
        const pDy = obs.nearestPickupY - obs.playerY;
        const pDist = obs.nearestPickupDist || 1;
        dx += (pDx / pDist) * params.pickupGreed;
        dy += (pDy / pDist) * params.pickupGreed;
      }

      // Edge avoidance
      const edgePush = getEdgePush(obs, params.edgeAvoidDist);
      dx += edgePush.x * params.edgeAvoidWeight;
      dy += edgePush.y * params.edgeAvoidWeight;

      // Normalize
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= len;
      dy /= len;

      if (hasEnemy) {
        lastMoveAngle = Math.atan2(dy, dx);
      }

      // Attack decision: only swing when it'll actually connect
      const inRange = obs.nearestEnemyDist < obs.weaponRange * params.attackMaxDist;
      const worthSwinging = obs.enemiesInArc >= params.attackMinEnemies;
      const shouldAttack = hasEnemy && inRange && worthSwinging && obs.weaponReady;

      return {
        dx, dy,
        attack: shouldAttack,
        targetX: obs.nearestEnemyX,
        targetY: obs.nearestEnemyY,
      };
    },

    chooseUpgrade(choices, obs) {
      return pickByPreference(choices, params.upgradePrefs, obs);
    },

    metadata() {
      return { tickCount };
    },
  };
}

// ── Shared helpers ──

function getMaxThreatDirection(obs) {
  const sectors = obs.sectorThreat;
  let maxIdx = 0;
  let maxVal = 0;
  for (let i = 0; i < sectors.length; i++) {
    if (sectors[i] > maxVal) {
      maxVal = sectors[i];
      maxIdx = i;
    }
  }
  const ang = ((maxIdx + 0.5) / sectors.length) * Math.PI * 2 - Math.PI;
  return { x: Math.cos(ang), y: Math.sin(ang) };
}

function getEdgePush(obs, avoidDist) {
  let px = 0, py = 0;
  if (obs.playerX < avoidDist) px = (avoidDist - obs.playerX) / avoidDist;
  if (obs.playerY < avoidDist) py = (avoidDist - obs.playerY) / avoidDist;
  if (obs.worldW - obs.playerX < avoidDist) px = -(avoidDist - (obs.worldW - obs.playerX)) / avoidDist;
  if (obs.worldH - obs.playerY < avoidDist) py = -(avoidDist - (obs.worldH - obs.playerY)) / avoidDist;
  return { x: px, y: py };
}

/** Score upgrade choices by category preference weights */
function pickByPreference(choices, prefs, obs) {
  if (choices.length === 0) return null;

  let bestId = choices[0].id;
  let bestScore = -Infinity;

  for (const c of choices) {
    let score = 0;

    // Survivability
    if (c.maxHpBonus) score += prefs.survivability * 2;
    if (c.armor) score += prefs.survivability * 1.5;
    if (c.regenRate) score += prefs.survivability * 2;
    if (c.healOnPickup) score += prefs.survivability * (obs.hpRatio < 0.5 ? 3 : 1);
    if (c.healPerKill) score += prefs.survivability * 1;
    if (c.effect === 'thorns') score += prefs.survivability * 1.5;
    if (c.effect === 'berserker') score += prefs.survivability * 0.5;

    // Damage
    if (c.damageMultiplier && c.damageMultiplier > 1) score += prefs.damage * 2;
    if (c.cooldownMultiplier && c.cooldownMultiplier < 1) score += prefs.damage * 1.5;
    if (c.effect === 'focus_fire') score += prefs.damage * 1.5;

    // AoE
    if (c.effect === 'kill_shockwave') score += prefs.aoe * 2;
    if (c.effect === 'explosive_fifth') score += prefs.aoe * 2;
    if (c.weapon === 'nova') score += prefs.aoe * 2;
    if (c.weapon === 'shotgun') score += prefs.aoe * 1.5;

    // Speed
    if (c.speedBonus) score += prefs.speed * 1.5;
    if (c.effect === 'speed_on_kill') score += prefs.speed * 2;

    // Utility
    if (c.pickupRadius) score += prefs.utility * 1;
    if (c.effect === 'magnet_heal') score += prefs.utility * 1.5;
    if (c.pierceCount) score += prefs.utility * 1.5;

    // Weapon choice: survival prefers sword (melee control, stun)
    if (c.weapon === 'sword' || c.effect === 'sword_mastery') score += prefs.survivability * 1.5;

    // Synergy bonus: if we already have the effect, value stacking higher
    if (c.maxStacks > 1 && obs.acquiredUpgrades.includes(c.id)) {
      score *= 1.2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestId = c.id;
    }
  }

  return bestId;
}

registerPolicy('survival', createSurvivalPolicy);

export { createSurvivalPolicy, DEFAULT_PARAMS as SURVIVAL_DEFAULTS };
