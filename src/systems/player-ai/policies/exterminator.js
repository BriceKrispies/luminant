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
 *  v4: Keep v3's kill_shockwave path. Add heal_now spam fallback
 *      (maxStacks=99) for late-game sustain.
 *  v4a (rejected): Tried berserker without tuning movement → 545 avg
 *      kills because my planner retreated at 20% HP, out of berserker's
 *      HP<50% activation zone. Berserker needs the planner to live
 *      dangerously.
 *  v5 (rejected): Mimicked neural's berserker path (sword → berserker →
 *      thorns → damage + aggressive weights). Regressed to 531 avg
 *      because my weights couldn't keep HP in berserker's [20%,50%]
 *      trigger zone — planner either held HP > 50% or dropped to panic.
 *      Berserker is movement-style-dependent; an MLP learned the band,
 *      explicit weights don't.
 *  v6-v7 (current): Keep v3's kill_shockwave path (+854 avg when offered
 *      alone vs berserker's +455 in direct comparison). Add a stateful
 *      HP-band controller in act() that gently biases movement toward
 *      clusters above 65% HP (dive), slows movement inside weapon range
 *      at 30-65% HP (hold), defers to planner below 30% (kite/flee).
 *      Gated by level >= 3 and distToEdge >= 180 to avoid early-game
 *      suicides and wall traps.
 *
 * Final 20-seed benchmark (seed=100, maxTicks=60000):
 *   - Strategist:   avg 1069 / max  1,455 / max level 13 / survived 0/20
 *   - Exterminator: avg 1141 / max  2,148 / max level 15 / survived 0/20
 *   - Neural:       avg 4325 / max 18,104 / max level 43 / survived 1/20
 *
 * 15k kills/avg unreachable for hand-coded. Neural hits 18k max because
 * the MLP learned sub-tick movement (when to stand still for thorns,
 * when to pivot, when to absorb a hit) that explicit weights can't
 * express. Exterminator's role: best available hand-coded baseline,
 * slightly above strategist, with better upside ceiling.
 *
 * Strategy:
 *  1. Build-priority chooseUpgrade: sword_mastery → kill_shockwave →
 *     damage stacks → thorns → regen → vampiric → hp → explosive_fifth →
 *     magnet → heal_now spam.
 *  2. HP-band movement controller (dive/hold/defer) gated by level + walls.
 *  3. Strategist's summoner/shooter re-aim + charger dash evasion preserved.
 *  4. Cluster-centroid aim for sword melee.
 */

import { registerPolicy } from '../../../ai/policy-types.js';
import { createUtilityPolicy, mergeWeights } from '../create-utility-policy.js';
import { createUpgradeStrategy } from '../upgrade-strategy.js';
import { BRAWLER_WEIGHTS } from './brawler.js';

// Base weights near brawler (proven kill-throughput base). The stateful
// HP-band controller in act() handles mode switching; weights are balanced
// for the mid-HP engagement mode.
const EXTERMINATOR_WEIGHTS = mergeWeights(BRAWLER_WEIGHTS, {
  flee: 0.4,
  kite: 0.4,
  hold_range: 0.6,
  reposition_for_shot: 1.0,
  collapse_on_cluster: 2.3,
  collect_xp: 0.7,
  boss_focus: 1.3,
  maintain_pressure: 2.5,
  hold_ground: 0.9,

  dangerWeight: 0.5,
  rewardWeight: 1.6,

  survivalBias: 0.4,
  greedBias: 0.5,
  preferredSpacing: 0.7,
  pickupGreed: 0.45,
  clusterPreference: 0.9,
  bossFocus: 0.7,
  commitmentTime: 12,
  smoothingRate: 0.30,
  intentionHysteresis: 0.15,
  retreatThreshold: 0.18,
  damageRiskTolerance: 0.72,
  attackEagerness: 1.6,

  upgradeWeights: {
    survivability: 2.3,
    damage: 2.3,
    aoe: 2.2,
    speed: 0.4,
    utility: 1.1,
    scaling: 2.1,
  },
});

// HP-band controller thresholds. The neural-trained policy learned to
// engage aggressively above ~65% HP, hold near clusters at 30-65%, and
// kite to recover below 30%.
const HP_AGGRESSIVE = 0.65;   // above this: bias toward cluster
const HP_HOLD       = 0.30;   // between HOLD and AGGRESSIVE: hold position, attack
const HP_RECOVER    = 0.15;   // below HOLD: kite; below RECOVER: hard flee
// Minimum cluster density required to trigger dive mode — avoids suicidal
// charges at sparse early-game enemies.
const DIVE_MIN_DENSITY = 5;
const HOLD_MIN_DENSITY = 2;

// Build priority — first match in choices wins, gated on per-id stack count.
// Tier locks (see src/systems/skills.js): L1 = weapon, L2 = signature,
// L3+ = power pool.
//   L1 → sword_mastery (70 DPS melee + wider cone)
//   L2 → kill_shockwave (always-on AOE chain on every kill)
//   L3+ → damage stacks first for raw DPS, then sustain (regen, vampiric,
//         hp), then explosive_fifth/magnet/thorns. Once power pool drains,
//         heal_now (maxStacks=99) becomes the only remaining option and
//         provides indefinite sustain.
// Build priority. Kill_shockwave at L2 (strictly better than berserker for
// hand-coded — data: berserker runs 455 avg kills, kill_shockwave runs
// 854 avg kills). Armor_thorns pulled earlier to slot 4 — thorns synergizes
// with aggressive engagement (reflect damage when contacted).
const BUILD_PRIORITY = [
  'sword_mastery',
  'kill_shockwave',   // always-on AOE chain — best hand-coded signature
  'damage_1',         // 1st stack — +20% dmg, +stun
  'armor_thorns',     // 1st stack — +15 contact reflect, +2 armor
  'regen_1',          // 1st stack — passive sustain
  'damage_1',         // 2nd stack
  'vampiric',         // 1st stack — kill-fed heal
  'hp_1',             // 1st stack — HP ceiling
  'damage_1',         // 3rd stack — caps at maxStacks=3
  'explosive_fifth',  // chain multiplier
  'armor_thorns',     // 2nd stack — caps at maxStacks=2
  'magnet_1',         // 1st stack — pickup radius
  'vampiric',         // 2nd stack — caps at maxStacks=2
  'regen_1',          // 2nd stack — caps at maxStacks=2
  'hp_1',             // 2nd stack
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

      // ── HP-band movement controller ──
      // Emulates the neural's learned behavior of aggressive engagement
      // above 60% HP, holding near clusters at 30-60% (where kill_shockwave
      // chains keep density manageable), kiting below 30% to let
      // regen/vampiric heal, hard-flee below 15%.
      const hp = obs.hpRatio;
      const bestIdx = bestClusterSectorIndex(obs.sectorDensity);
      const densestSector = bestIdx >= 0 ? obs.sectorDensity[bestIdx] : 0;

      // Early-game gate: no HP-band controller until level 3+ (kill_shockwave
      // + at least one tier-3 pick unlocked). Before that, the base planner's
      // gentler movement is safer.
      const bandEnabled = (obs.level || 0) >= 3;
      // Wall gate: never dive with a wall at our back. Chargers + summoners
      // exploit cornered players.
      const nearWall = (obs.distToEdge || 999) < 180;

      if (bandEnabled && !nearWall && hp > HP_AGGRESSIVE && densestSector >= DIVE_MIN_DENSITY) {
        // Mode: dive. Only with a real cluster (5+ enemies in one sector).
        // Gentle bias toward cluster — the base planner usually already
        // wants the cluster, we just accelerate slightly.
        const angle = (bestIdx / 8) * Math.PI * 2 - Math.PI;
        const clusterDx = Math.cos(angle);
        const clusterDy = Math.sin(angle);
        action.dx = action.dx * 0.7 + clusterDx * 0.3;
        action.dy = action.dy * 0.7 + clusterDy * 0.3;
      } else if (bandEnabled
                 && hp > HP_HOLD
                 && densestSector >= HOLD_MIN_DENSITY
                 && obs.nearestEnemyDist < obs.weaponRange * 1.1) {
        // Mode: hold. Inside weapon range with a cluster — reduce motion
        // slightly so kill_shockwave cascades hit closer-packed targets
        // and vampiric procs keep pace with contact damage.
        action.dx *= 0.6;
        action.dy *= 0.6;
      }
      // Otherwise: defer to base planner (which already has flee/kite logic).

      // Cluster-centroid aim: bias aim into densest sector (non-nova only).
      const clusteredSectors = countClusteredSectors(obs.sectorDensity);
      if (obs.weapon !== 'nova'
          && obs.weaponReady
          && clusteredSectors >= 2
          && bestIdx >= 0
          && obs.sectorDensity[bestIdx] >= 4) {
        const angle = (bestIdx / 8) * Math.PI * 2 - Math.PI;
        action.targetX = obs.playerX + Math.cos(angle) * CLUSTER_AIM_DISTANCE;
        action.targetY = obs.playerY + Math.sin(angle) * CLUSTER_AIM_DISTANCE;
      }

      // Strategist priority re-aim: summoners (one kill removes ~12 future
      // enemies) and shooters (chip damage) take precedence over cluster aim.
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

      // Renormalize movement vector if band controller inflated it.
      const mag = Math.hypot(action.dx, action.dy);
      if (mag > 1) {
        action.dx /= mag;
        action.dy /= mag;
      }

      return action;
    },

    chooseUpgrade(choices, obs) {
      if (!choices || choices.length === 0) return null;

      // Emergency heal at critical HP — heal_now gives +25% max HP instantly.
      // Only trigger below 25% to avoid wasting heals when berserker is firing.
      if (obs.hpRatio < 0.25) {
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
