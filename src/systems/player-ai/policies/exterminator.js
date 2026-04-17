/**
 * Exterminator policy — hybrid tactical policy.
 *
 * Combines the trained neural network for tick-by-tick movement + aim with
 * a mostly-deterministic build-priority list for upgrades, plus
 * strategist-style loss-prevention overrides.
 *
 * Why hybrid (vs pure utility or pure neural):
 *   - Pure hand-coded utility caps at ~1400 avg kills because late-game
 *     (Phase 4+ / overtime) requires sub-tick tactical decisions (thorns
 *     positioning, gap timing, contact absorption) that explicit weights
 *     can't express.
 *   - Pure neural (trained with maxTicks=60000) achieves 4325 avg but has
 *     high upgrade-RNG variance — unlucky seeds pick suboptimally at L1/L2
 *     and stall.
 *   - Hybrid: neural handles movement (where it dominates), deterministic
 *     priority forces the sword → berserker → thorns → damage → vampiric
 *     build on every run, emergency heal gate matches neural's learned
 *     preference. Every run gets the MLP's late-game expertise AND the
 *     optimal build.
 *
 * Iteration history (full v1-v15 utility-policy variants in git log):
 *   v1–v4 : nova + kill_shockwave combos → ~1200 avg (strategist parity)
 *   v5    : mimicked neural's berserker path → 531 avg (movement mismatch)
 *   v6-v15: HP-band controller + wall repulsion + weight tuning → 1368 avg
 *   v16   : hybrid with kill_shockwave priority → 3551 avg (below raw neural)
 *   v17 (current): hybrid with berserker priority + hp<0.5 heal gate
 *
 * Benchmarks (maxTicks=60000):
 *   20-seed (seed=100):
 *     Strategist:    avg 1,069 / max  1,455 / survived 0/20
 *     Hand-coded v15: avg 1,368 / max  2,921 / survived 0/20
 *     Neural alone:  avg 4,325 / max 18,104 / survived 1/20
 *     Exterminator:  avg 5,238 / max 17,650 / survived 2/20 (3 runs >15k)
 *   30-seed (seed=500):
 *     Exterminator:  avg 4,324 / max 20,280 / survived 1/30
 *   Combined 50-seed avg: ~4,690 kills
 *
 * Overrides layered on top of neural act():
 *   1. Summoner/shooter priority re-aim
 *   2. Charger dash perpendicular evasion
 *   3. Deterministic chooseUpgrade via BUILD_PRIORITY
 *   4. Emergency heal_now at HP < 50% (matches neural's learned preference)
 *
 * The ~4-5k avg still falls short of 15k avg. Reaching 15k avg would
 * require either (a) a materially better-trained neural, (b) changing
 * the game balance to make early-game survivable on all seeds (currently
 * some seeds are unwinnable in Phase 1-2 even for neural), or (c) an
 * ensemble / MCTS approach that plans several moves ahead. All three
 * are out of scope for weight-tuning.
 */

import { registerPolicy } from '../../../ai/policy-types.js';
import { createNeuralPolicy } from '../../../ai/neural/neural-policy.js';
import { createUpgradeStrategy } from '../upgrade-strategy.js';

// Deterministic build priority. First offered match wins, gated by per-id
// stack count. Covers the upgrade path that neural's best-seed runs
// stumbled onto via RNG; we enforce it every run.
//
// Tier locks in src/systems/skills.js:
//   L1 = weapon (sword/shotgun/nova)
//   L2 = signature (kill_shockwave/berserker/pierce/focus_fire)
//   L3+ = power pool
const BUILD_PRIORITY = [
  'sword_mastery',    // 70 DPS melee cone — proven winner for this game
  // Neural's movement keeps HP in the [20%, 50%] band where berserker's
  // +80% fire rate triggers. Direct comparison on neural's best runs:
  // berserker paths hit max 18,104 kills; kill_shockwave paths plateau
  // earlier. Pair berserker with thorns (both get +1 sword synergy).
  'berserker',
  'armor_thorns',     // 1st stack — +15 contact reflect + 2 armor
  'damage_1',         // 1st stack — +20% dmg + longer stun
  'regen_1',          // 1st stack — 2 HP/sec baseline
  'vampiric',         // 1st stack — 3 HP per kill
  'damage_1',         // 2nd stack
  'armor_thorns',     // 2nd stack — caps at maxStacks=2
  'hp_1',             // 1st stack — +30 max HP
  'damage_1',         // 3rd stack — caps at maxStacks=3
  'explosive_fifth',  // every 5th hit AOE
  'magnet_1',         // 1st stack — +30 pickup radius
  'vampiric',         // 2nd stack — caps at maxStacks=2
  'regen_1',          // 2nd stack — caps at maxStacks=2
  'hp_1',             // 2nd stack
  'magnet_1',         // 2nd stack
  'hp_1',             // 3rd stack
  'magnet_1',         // 3rd stack — caps at maxStacks=3
  'hp_1',             // 4th stack — caps at maxStacks=4
  // heal_now (maxStacks=99) falls through.
];

const FALLBACK_HEAL_ID = 'heal_now';

// Strategist-style loss-prevention overrides — neural learned movement
// mostly handles these, but this layer catches the edge cases.
const DASH_EVADE_RADIUS = 120;
const PRIORITY_AIM_RADIUS = 380;

// Upgrade weights used only when nothing in BUILD_PRIORITY is offered
// (rare — usually only if the player is offered 3 already-capped picks).
const FALLBACK_UPGRADE_WEIGHTS = {
  upgradeWeights: {
    survivability: 2.5,
    damage: 2.3,
    aoe: 2.0,
    speed: 0.5,
    utility: 1.0,
    scaling: 2.0,
  },
  clusterPreference: 0.9,
  survivalBias: 0.3,
  kite: 0.3,
};

function createExterminatorPolicy(overrides = {}) {
  // Neural policy provides movement + aim (tick-by-tick tactical decisions).
  const neuralPolicy = createNeuralPolicy();
  // Fallback upgrade scorer for the (rare) case that no priority id is offered.
  const fallbackUpgrader = createUpgradeStrategy(FALLBACK_UPGRADE_WEIGHTS);

  return {
    name: 'Exterminator',
    id: 'exterminator',
    params: {
      hybrid: true,
      neural: neuralPolicy.params,
      buildPriority: BUILD_PRIORITY.length,
    },

    reset() {
      neuralPolicy.reset();
    },

    act(obs) {
      const action = neuralPolicy.act(obs);

      // Summoner/shooter priority re-aim: one summoner kill removes ~12
      // future enemies, shooters chip HP from range. Re-aim when they're
      // in weapon range and cooldown is ready.
      const priority = pickPriorityTarget(obs);
      if (priority
          && obs.weaponReady
          && priority.dist <= obs.weaponRange * 0.95) {
        action.targetX = priority.x;
        action.targetY = priority.y;
        action.attack = 1;
      }

      // Charger dash evasion: strafe perpendicular to incoming dasher.
      if (obs.incomingDasher && obs.incomingDasher.dist < DASH_EVADE_RADIUS) {
        const dash = obs.incomingDasher;
        const toDx = dash.x - obs.playerX;
        const toDy = dash.y - obs.playerY;
        const len = Math.hypot(toDx, toDy) || 1;
        let perpX = -toDy / len;
        let perpY = toDx / len;
        // pick the perp direction closer to neural's current choice
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

      // Emergency heal: below 50% HP prefer heal_now (25% max HP instant
      // heal) over the priority list. Matches the behavior in
      // createUpgradeStrategy which boosts heal picks when hpRatio < 0.5 —
      // this is what lets neural's best seeds survive Phase 2 spikes.
      if (obs.hpRatio < 0.5) {
        const heal = choices.find(c => c.healOnPickup);
        if (heal) return heal.id;
      }

      // Walk priority list. Each id may appear multiple times to represent
      // additional desired stacks; track how many times we've already
      // matched that id in this pass to allow stacking.
      const acquired = obs.acquiredUpgrades || [];
      const matchedThisPass = new Map();

      for (const id of BUILD_PRIORITY) {
        const offered = choices.find(c => c.id === id);
        if (!offered) continue;

        const ownedCount = acquired.filter(a => a === id).length;
        const passCount = matchedThisPass.get(id) || 0;
        const desiredStack = passCount + 1;

        if (ownedCount >= desiredStack) {
          matchedThisPass.set(id, passCount + 1);
          continue;
        }
        if (offered.maxStacks && ownedCount >= offered.maxStacks) {
          matchedThisPass.set(id, passCount + 1);
          continue;
        }

        return id;
      }

      // Priority list exhausted — prefer heal_now (maxStacks=99, always
      // offered, +25% max HP) for late-game sustain.
      const heal = choices.find(c => c.id === FALLBACK_HEAL_ID);
      if (heal) return heal.id;

      // Final fallback: defer to category-weighted scorer.
      return fallbackUpgrader.choose(choices, obs);
    },

    metadata() {
      return { type: 'hybrid', movement: 'neural', upgrades: 'deterministic' };
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

registerPolicy('exterminator', createExterminatorPolicy);

export { createExterminatorPolicy };
