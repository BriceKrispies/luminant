/**
 * Progression policy — prioritizes XP gain and leveling.
 *
 * Behaviors:
 *   - Aggressively seeks enemies and engages at close range
 *   - Prioritizes XP pickups
 *   - Takes reasonable risks for faster leveling
 *   - Prefers damage/AoE upgrades over survivability
 *   - Charges into groups for AoE value
 *
 * Fully parameterized for evolution/tuning.
 */

import { registerPolicy } from '../policy-types.js';

const DEFAULT_PARAMS = {
  // Movement
  dangerRadius: 30,          // only flee at very close range
  meleeEngageRadius: 40,     // get right in melee range
  rangedEngageRadius: 100,   // preferred ranged distance
  chargeThreshold: 6,        // charge into groups of this size for AoE value
  chargeWeight: 0.5,         // how aggressively to charge clusters
  edgeAvoidDist: 80,
  edgeAvoidWeight: 1.0,

  // Pickup greed
  pickupGreed: 0.7,          // strongly chase pickups
  pickupMaxDist: 350,        // chase pickups from further away
  xpPickupPriority: 1.5,    // extra weight on XP pickups vs health

  // Attack
  alwaysAttack: true,
  aggressiveRange: 200,      // will move toward enemies at this range

  // Risk tolerance
  lowHPFleeThreshold: 0.2,  // only flee when very low HP
  riskTolerance: 0.8,        // 0 = cautious, 1 = reckless

  // Upgrade preferences
  upgradePrefs: {
    survivability: 0.4,
    damage: 1.5,
    aoe: 1.8,
    speed: 1.0,
    utility: 1.2,          // magnet, pickup radius = more XP
    scaling: 1.5,           // effects that scale with level/kills
  },
};

function createProgressionPolicy(overrides = {}) {
  const params = { ...DEFAULT_PARAMS, ...overrides };
  if (overrides.upgradePrefs) {
    params.upgradePrefs = { ...DEFAULT_PARAMS.upgradePrefs, ...overrides.upgradePrefs };
  }

  let tickCount = 0;

  function getPreferredDist(obs) {
    if (obs.weapon === 'sword') return params.meleeEngageRadius;
    return params.rangedEngageRadius;
  }

  return {
    name: 'Progression',
    id: 'progression',
    params,

    reset() {
      tickCount = 0;
    },

    act(obs) {
      tickCount++;
      let dx = 0;
      let dy = 0;

      const hasEnemy = obs.nearestEnemyDist < 500;
      const lowHP = obs.hpRatio < params.lowHPFleeThreshold;
      const preferredDist = getPreferredDist(obs);

      // Panic flee when very low HP
      if (lowHP && hasEnemy && obs.nearestEnemyDist < 100) {
        const eDx = obs.nearestEnemyX - obs.playerX;
        const eDy = obs.nearestEnemyY - obs.playerY;
        const eDist = obs.nearestEnemyDist || 1;
        dx = -(eDx / eDist);
        dy = -(eDy / eDist);
      } else if (hasEnemy) {
        const eDx = obs.nearestEnemyX - obs.playerX;
        const eDy = obs.nearestEnemyY - obs.playerY;
        const eDist = obs.nearestEnemyDist || 1;
        const normX = eDx / eDist;
        const normY = eDy / eDist;

        // Should we charge a cluster for AoE?
        const shouldCharge = obs.nearEnemyCount >= params.chargeThreshold &&
          obs.hpRatio > 0.4;

        if (shouldCharge) {
          // Move toward densest sector
          const denseDir = getMaxDensityDirection(obs);
          dx = denseDir.x * params.chargeWeight + normX * 0.5;
          dy = denseDir.y * params.chargeWeight + normY * 0.5;
        } else if (eDist > preferredDist * 1.3) {
          // Too far — close distance aggressively
          dx = normX * 0.9;
          dy = normY * 0.9;
        } else if (eDist < params.dangerRadius && obs.hpRatio < 0.4) {
          // Very close and somewhat low — slight retreat
          dx = -normX * 0.5;
          dy = -normY * 0.5;
        } else if (eDist < preferredDist * 0.7) {
          // Slightly too close — strafe
          const perpX = -normY;
          const perpY = normX;
          dx = perpX * 0.7;
          dy = perpY * 0.7;
        } else {
          // Maintain attack distance, slight approach bias
          const perpX = -normY;
          const perpY = normX;
          const approachBias = (eDist - preferredDist) / preferredDist * 0.5;
          dx = perpX * 0.4 + normX * (approachBias + 0.1);
          dy = perpY * 0.4 + normY * (approachBias + 0.1);
        }
      }

      // Aggressively chase pickups
      if (obs.nearestPickupDist < params.pickupMaxDist) {
        const pDx = obs.nearestPickupX - obs.playerX;
        const pDy = obs.nearestPickupY - obs.playerY;
        const pDist = obs.nearestPickupDist || 1;
        const pickupWeight = params.pickupGreed *
          (obs.nearEnemyCount < 3 ? 1.5 : 0.8); // even more aggressive when safe
        dx += (pDx / pDist) * pickupWeight;
        dy += (pDy / pDist) * pickupWeight;
      }

      // Edge avoidance (lighter than survival)
      const edgePush = getEdgePush(obs, params.edgeAvoidDist);
      dx += edgePush.x * params.edgeAvoidWeight;
      dy += edgePush.y * params.edgeAvoidWeight;

      // Normalize
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= len;
      dy /= len;

      return {
        dx, dy,
        attack: hasEnemy && (params.alwaysAttack || obs.nearestEnemyDist < params.aggressiveRange),
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

// ── Helpers ──

function getMaxDensityDirection(obs) {
  const sectors = obs.sectorDensity;
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

function pickByPreference(choices, prefs, obs) {
  if (choices.length === 0) return null;

  let bestId = choices[0].id;
  let bestScore = -Infinity;

  for (const c of choices) {
    let score = 0;

    // Survivability (low priority for progression)
    if (c.maxHpBonus) score += prefs.survivability * 1.5;
    if (c.regenRate) score += prefs.survivability * 1;
    if (c.healOnPickup) score += prefs.survivability * (obs.hpRatio < 0.3 ? 2 : 0.5);

    // Damage (high priority)
    if (c.damageMultiplier && c.damageMultiplier > 1) score += prefs.damage * 2;
    if (c.cooldownMultiplier && c.cooldownMultiplier < 1) score += prefs.damage * 2;
    if (c.effect === 'focus_fire') score += prefs.damage * 1.5;
    if (c.effect === 'berserker') score += prefs.damage * 2; // synergizes with aggressive play

    // AoE (highest priority — more kills = more XP)
    if (c.effect === 'kill_shockwave') score += prefs.aoe * 3;
    if (c.effect === 'explosive_fifth') score += prefs.aoe * 2.5;
    if (c.weapon === 'nova') score += prefs.aoe * 2.5;
    if (c.weapon === 'shotgun') score += prefs.aoe * 2;
    if (c.weapon === 'sword' || c.effect === 'sword_mastery') score += prefs.aoe * 1.5;

    // Speed
    if (c.speedBonus) score += prefs.speed * 1;
    if (c.effect === 'speed_on_kill') score += (prefs.speed + prefs.scaling) * 1;

    // Utility / XP gains
    if (c.pickupRadius) score += prefs.utility * 2; // bigger pickup radius = more XP
    if (c.effect === 'magnet_heal') score += prefs.utility * 2;
    if (c.pierceCount) score += prefs.utility * 1.5;

    // Scaling effects (value increases with level)
    if (c.effect === 'scaling_regen') score += prefs.scaling * (obs.level > 5 ? 2 : 1);
    if (c.effect === 'vampiric') score += prefs.scaling * 1.5; // heal from kills = sustain

    // Synergy
    if (c.maxStacks > 1 && obs.acquiredUpgrades.includes(c.id)) {
      score *= 1.3;
    }

    if (score > bestScore) {
      bestScore = score;
      bestId = c.id;
    }
  }

  return bestId;
}

registerPolicy('progression', createProgressionPolicy);

export { createProgressionPolicy, DEFAULT_PARAMS as PROGRESSION_DEFAULTS };
