/**
 * Exterminator policy — high-throughput build aimed at maximizing total
 * kills over a long sim run.
 *
 * Iteration history:
 *  v1: Forced nova_unlock at L1 → 388 kills, 96s survival. Nova at L1 is
 *      ~20 DPS vs sword's 70.
 *  v2: Reordered priority list → marginal gain. Tier locks meant late-game
 *      power picks couldn't be hoisted to L2 anyway.
 *  v3: Sword + kill_shockwave + chain combo → 1167 avg kills, ~strategist
 *      parity.
 *  v4a (rejected): Tried berserker over kill_shockwave (mimicking trained
 *      neural's best run). Result: berserker runs scored 545 avg vs
 *      kill_shockwave runs 1395 avg. Berserker only fires +80% rate at
 *      HP < 50% — neural learned to "live dangerously" in that band; my
 *      planner retreats earlier (retreatThreshold=0.2) so the trigger
 *      rarely fires. Berserker is movement-style-dependent and not
 *      additive for hand-coded policies.
 *  v4 (current): Keep v3's kill_shockwave path. Add heal_now spam
 *      fallback (maxStacks=99) for late-game sustain — strict additive
 *      improvement, observed in trained neural's best runs.
 *
 * Note: a freshly trained neural (npm run train --maxTicks=60000) hit
 * 5398 avg / 15,825 max kills. Hand-coded policies cap at ~1200 avg
 * because the late-game requires sub-tick movement decisions (when to
 * stand still for thorns, when to pivot through enemy gaps) that an MLP
 * learns but explicit weights can't easily express.
 *
 * Strategy:
 *  1. Build-priority chooseUpgrade: sword_mastery → kill_shockwave →
 *      damage_1 stacks → sustain (regen, vampiric, hp) → explosive_fifth →
 *      magnet/thorns → heal_now spam (additive late-game heal).
 *  2. Brawler-like intention weights with mild cluster bias.
 *  3. Strategist's summoner/shooter re-aim + charger dash evasion preserved.
 *  4. Cluster-centroid aim for sword melee.
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
// L3+ = power pool.
//   L1 → sword_mastery (70 DPS melee + wider cone)
//   L2 → kill_shockwave (always-on AOE chain on every kill)
//   L3+ → damage stacks first for raw DPS, then sustain (regen, vampiric,
//         hp), then explosive_fifth/magnet/thorns. Once power pool drains,
//         heal_now (maxStacks=99) becomes the only remaining option and
//         provides indefinite sustain.
const BUILD_PRIORITY = [
  'sword_mastery',
  'kill_shockwave',
  'damage_1',         // 1st stack — +20% dmg, +stun
  'regen_1',          // 1st stack — passive sustain
  'damage_1',         // 2nd stack
  'vampiric',         // 1st stack — kill-fed heal
  'hp_1',             // 1st stack — HP ceiling
  'damage_1',         // 3rd stack — caps at maxStacks=3
  'explosive_fifth',  // chain multiplier on top of sword's high hit rate
  'magnet_1',         // 1st stack — pickup radius
  'armor_thorns',     // 1st stack — passive contact DPS + 2 armor
  'vampiric',         // 2nd stack — caps at maxStacks=2
  'regen_1',          // 2nd stack — caps at maxStacks=2
  'hp_1',             // 2nd stack
  'armor_thorns',     // 2nd stack — caps at maxStacks=2
  'magnet_1',         // 2nd stack
  'hp_1',             // 3rd stack
  'magnet_1',         // 3rd stack — caps at maxStacks=3
  'hp_1',             // 4th stack — caps at maxStacks=4
  // FALLBACK_HEAL_ID (heal_now, maxStacks=99) takes over after this list.
];

// Once all priority picks are exhausted, fall back to heal_now (maxStacks=99,
// always offered, gives 25% max HP heal) — the neural-trained policy spammed
// this for late-game sustain.
const FALLBACK_HEAL_ID = 'heal_now';

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

      // Once priority list is exhausted, prefer heal_now (maxStacks=99,
      // always offered, +25% max HP) for late-game sustain.
      const heal = choices.find(c => c.id === FALLBACK_HEAL_ID);
      if (heal) return heal.id;

      // Final fallback: defer to the base category-weighted scorer.
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
