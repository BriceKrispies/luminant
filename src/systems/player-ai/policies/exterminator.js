/**
 * Exterminator policy — high-throughput AOE-chain build aimed at maximizing
 * total kills over a long sim run.
 *
 * Strategy:
 *  1. Force the AOE chain combo via a build-priority chooseUpgrade override:
 *       nova_unlock → kill_shockwave → explosive_fifth → vampiric → hp →
 *       regen → magnet → damage stacks. The default scorer is a fallback
 *       only when none of the priority upgrades are offered.
 *  2. Push intention weights toward dense-cluster engagement so the planner
 *      wades into mass instead of kiting.
 *  3. Keep strategist's loss-prevention overrides (summoner/shooter re-aim,
 *      charger dash perpendicular evasion) — these prevent death/snowball
 *      and gate access to overtime where the bulk of kills materialize.
 *  4. Pre-nova fallback: while the player still holds a sword, bias aim into
 *      the densest sector centroid so the cone hits more bodies per swing.
 */

import { registerPolicy } from '../../../ai/policy-types.js';
import { createUtilityPolicy, mergeWeights } from '../create-utility-policy.js';
import { createUpgradeStrategy } from '../upgrade-strategy.js';
import { BRAWLER_WEIGHTS } from './brawler.js';

const EXTERMINATOR_WEIGHTS = mergeWeights(BRAWLER_WEIGHTS, {
  flee: 0.25,
  kite: 0.2,
  hold_range: 0.4,
  reposition_for_shot: 1.0,
  collapse_on_cluster: 3.5,
  collect_xp: 0.6,
  boss_focus: 1.5,
  maintain_pressure: 3.0,
  hold_ground: 0.7,

  dangerWeight: 0.3,
  rewardWeight: 2.0,

  survivalBias: 0.2,
  greedBias: 0.7,
  preferredSpacing: 0.5,
  pickupGreed: 0.5,
  clusterPreference: 1.0,
  bossFocus: 0.7,
  commitmentTime: 10,
  smoothingRate: 0.40,
  intentionHysteresis: 0.10,
  retreatThreshold: 0.15,
  damageRiskTolerance: 0.85,
  attackEagerness: 2.0,

  upgradeWeights: {
    survivability: 1.8,
    damage: 2.2,
    aoe: 2.8,
    speed: 0.4,
    utility: 1.2,
    scaling: 2.0,
  },
});

// Build priority — first match in choices wins, gated on per-id stack count.
const BUILD_PRIORITY = [
  'nova_unlock',
  'kill_shockwave',
  'explosive_fifth',
  'vampiric',     // 1st stack
  'hp_1',         // 1st stack
  'regen_1',      // 1st stack
  'magnet_1',     // 1st stack
  'damage_1',     // any stack
  'vampiric',     // 2nd stack (duplicate intentional)
  'pierce',
  'armor_thorns',
  'hp_1',         // later stacks
  'regen_1',      // later stacks
  'magnet_1',     // later stacks
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
