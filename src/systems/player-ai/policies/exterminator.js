/**
 * Exterminator policy — high-throughput build aimed at maximizing total
 * kills over a long sim run.
 *
 * Iteration history:
 *  v1: Forced nova_unlock at L1 + aggressive cluster collapse → 388 kills,
 *      96s survival (worse than strategist's 1216 / 251s baseline). Nova at
 *      L1 has 12dmg×12-burst on 1.2s cd radial; vs single early-game enemy
 *      only 1-2 projectiles hit ≈ 20 DPS. Sword is 70 DPS at L1.
 *  v2: Reordered priority list, softened weights → marginal gain (436/119s).
 *      Vampiric/hp_1/regen never appeared at L2 because tier-locked: L1=
 *      weapon, L2=signature, L3+=power.
 *  v3 (current): Use sword_mastery at L1 (the proven melee DPS path), keep
 *      kill_shockwave + explosive_fifth chain, then sustain (vampiric,
 *      regen, hp) and damage stacks. Brawler-like weights. Goal: beat
 *      strategist's ~1216 avg by being slightly more aggressive about
 *      cluster engagement and explicitly forcing the chain-combo path.
 *
 * Strategy:
 *  1. Build-priority chooseUpgrade override: sword_mastery → kill_shockwave →
 *      damage_1 → regen_1 → vampiric → hp_1 → explosive_fifth → magnet → ...
 *      Falls back to default scorer when no priority id is offered.
 *  2. Intention weights nudged toward cluster engagement (vs brawler) but not
 *      suicidal — collapse_on_cluster slightly above brawler, danger weight
 *      slightly below.
 *  3. Strategist loss-prevention overrides preserved: summoner/shooter
 *      re-aim, charger dash evasion. These gate survival to high-density
 *      mid/late phases where the bulk of kills happen.
 *  4. Cluster-centroid aim for sword: bias aim into densest sector when
 *      multiple sectors are clustered, so the 70°-cone hits more enemies.
 */

import { registerPolicy } from '../../../ai/policy-types.js';
import { createUtilityPolicy, mergeWeights } from '../create-utility-policy.js';
import { createUpgradeStrategy } from '../upgrade-strategy.js';
import { BRAWLER_WEIGHTS } from './brawler.js';

const EXTERMINATOR_WEIGHTS = mergeWeights(BRAWLER_WEIGHTS, {
  flee: 0.35,
  kite: 0.3,
  hold_range: 0.5,
  reposition_for_shot: 0.9,
  collapse_on_cluster: 2.5,
  collect_xp: 0.6,
  boss_focus: 1.5,
  maintain_pressure: 2.8,
  hold_ground: 0.9,

  dangerWeight: 0.4,
  rewardWeight: 1.7,

  survivalBias: 0.4,         // > 0.6 unlocks sword pick bonus, but we also force it
  greedBias: 0.55,
  preferredSpacing: 0.65,
  pickupGreed: 0.4,
  clusterPreference: 0.9,
  bossFocus: 0.7,
  commitmentTime: 13,
  smoothingRate: 0.28,
  intentionHysteresis: 0.18,
  retreatThreshold: 0.2,
  damageRiskTolerance: 0.75,
  attackEagerness: 1.6,

  upgradeWeights: {
    survivability: 2.0,
    damage: 2.4,
    aoe: 2.0,
    speed: 0.5,
    utility: 1.0,
    scaling: 2.0,
  },
});

// Build priority — first match in choices wins, gated on per-id stack count.
// Tier locks (see src/systems/skills.js): L1 = weapon, L2 = signature,
// L3+ = power pool. Order reflects what's reachable when:
//   L1 → sword_mastery (proven 70 DPS melee, scales with damage stacks)
//   L2 → kill_shockwave (chain explosions multiply sword swings)
//   L3+ → damage_1 stacked first for raw DPS, then sustain (regen, vampiric,
//         hp), then explosive_fifth/magnet/thorns power picks.
const BUILD_PRIORITY = [
  'sword_mastery',
  'kill_shockwave',
  'damage_1',         // 1st stack — +20% dmg, +stun
  'regen_1',          // 1st stack — passive sustain
  'damage_1',         // 2nd stack
  'vampiric',         // 1st stack — kill-fed heal
  'hp_1',             // 1st stack — HP ceiling
  'damage_1',         // 3rd stack
  'explosive_fifth',  // chain multiplier on top of sword's high hit rate
  'magnet_1',         // 1st stack — pickup radius
  'armor_thorns',     // 1st stack — passive contact DPS + 2 armor
  'vampiric',         // 2nd stack
  'regen_1',          // 2nd stack
  'hp_1',             // 2nd stack
  'armor_thorns',     // 2nd stack
  'magnet_1',         // 2nd stack
  'hp_1',             // 3rd stack
  'magnet_1',         // 3rd stack
  'hp_1',             // 4th stack
];

const DASH_EVADE_RADIUS = 120;
const PRIORITY_AIM_RADIUS = 380;
const CLUSTER_AIM_DISTANCE = 70;

function createExterminatorPolicy(overrides = {}) {
  const weights = mergeWeights(EXTERMINATOR_WEIGHTS, overrides);
  const base = createUtilityPolicy('Exterminator', 'exterminator', weights);
  const fallbackUpgrader = createUpgradeStrategy(weights);

  return {
    ...base,

    act(obs) {
      const action = base.act(obs);

      // Pre-nova cluster-centroid aim: with sword/shotgun, biasing the aim
      // into the densest sector multiplies hits per swing. Skip for nova
      // (radial 360° pattern doesn't care about aim direction).
      const clusteredSectors = countClusteredSectors(obs.sectorDensity);
      if (obs.weapon !== 'nova'
          && obs.weaponReady
          && clusteredSectors >= 2) {
        const bestIdx = bestClusterSectorIndex(obs.sectorDensity);
        if (bestIdx >= 0 && obs.sectorDensity[bestIdx] >= 4) {
          const angle = (bestIdx / 8) * Math.PI * 2 - Math.PI;
          action.targetX = obs.playerX + Math.cos(angle) * CLUSTER_AIM_DISTANCE;
          action.targetY = obs.playerY + Math.sin(angle) * CLUSTER_AIM_DISTANCE;
        }
      }

      // Strategist priority re-aim: summoners (one kill removes ~12 future
      // enemies) and shooters (chip damage prevention) take precedence over
      // cluster aim when in range and weapon is ready.
      const priority = pickPriorityTarget(obs);
      if (priority
          && obs.weaponReady
          && priority.dist <= obs.weaponRange * 0.95) {
        action.targetX = priority.x;
        action.targetY = priority.y;
        action.attack = 1;
      }

      // Dash evasion: charger in dash sub-phase within 120px → strafe perp.
      if (obs.incomingDasher && obs.incomingDasher.dist < DASH_EVADE_RADIUS) {
        const dash = obs.incomingDasher;
        const dx = dash.x - obs.playerX;
        const dy = dash.y - obs.playerY;
        const len = Math.hypot(dx, dy) || 1;
        let perpX = -dy / len;
        let perpY = dx / len;
        if (action.dx * perpX + action.dy * perpY < 0) {
          perpX = -perpX;
          perpY = -perpY;
        }
        action.dx = perpX;
        action.dy = perpY;
      }

      return action;
    },

    chooseUpgrade(choices, obs) {
      if (!choices || choices.length === 0) return null;

      // Emergency heal at low HP.
      if (obs.hpRatio < 0.4) {
        const heal = choices.find(c => c.healOnPickup);
        if (heal) return heal.id;
      }

      // Walk priority list. Each id may appear multiple times to represent
      // additional desired stacks; we count how many times we've already
      // matched that id in this pass to allow stacking.
      const acquired = obs.acquiredUpgrades || [];
      const matchedThisPass = new Map();

      for (const id of BUILD_PRIORITY) {
        const offered = choices.find(c => c.id === id);
        if (!offered) continue;

        const ownedCount = acquired.filter(a => a === id).length;
        const passCount = matchedThisPass.get(id) || 0;
        const desiredStack = passCount + 1; // 1st occurrence = 1st stack, etc.

        // Skip if we already own this stack tier or higher.
        if (ownedCount >= desiredStack) {
          matchedThisPass.set(id, passCount + 1);
          continue;
        }

        // Skip if upgrade is at maxStacks (defensive — game shouldn't offer it).
        if (offered.maxStacks && ownedCount >= offered.maxStacks) {
          matchedThisPass.set(id, passCount + 1);
          continue;
        }

        return id;
      }

      // Fallback: none of the priority ids are present — defer to the base
      // category-weighted scorer so we still pick something sensible.
      return fallbackUpgrader.choose(choices, obs);
    },
  };
}

function pickPriorityTarget(obs) {
  const summoner = obs.nearestSummoner;
  if (summoner && summoner.dist <= PRIORITY_AIM_RADIUS) return summoner;
  const shooter = obs.nearestShooter;
  if (shooter && shooter.dist <= PRIORITY_AIM_RADIUS) return shooter;
  return null;
}

function countClusteredSectors(sectorDensity) {
  if (!sectorDensity) return 0;
  let n = 0;
  for (let i = 0; i < sectorDensity.length; i++) {
    if (sectorDensity[i] >= 2) n++;
  }
  return n;
}

function bestClusterSectorIndex(sectorDensity) {
  if (!sectorDensity) return -1;
  let bestIdx = -1;
  let bestVal = 0;
  for (let i = 0; i < sectorDensity.length; i++) {
    if (sectorDensity[i] > bestVal) {
      bestVal = sectorDensity[i];
      bestIdx = i;
    }
  }
  return bestIdx;
}

registerPolicy('exterminator', createExterminatorPolicy);

export { createExterminatorPolicy, EXTERMINATOR_WEIGHTS };
