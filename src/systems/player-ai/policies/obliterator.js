/**
 * Obliterator policy — survival-scaling AoE build tuned to beat 15k kills.
 *
 * Core thesis: the game escalates infinitely past 420s (see director.js). To
 * get 15k kills we need to survive deep into the infinite scaling phase and
 * turn kills into exponential value. Strategist tops out at ~1k kills,
 * ~190s survival because a sword build alone can't out-clear phase 4's 500+
 * concurrent enemies spawning on a 0.05s interval.
 *
 * Approach:
 *   1. Combat brain is the utility scorer (strategist / brawler proved it
 *      survives phases 1-3 reliably — don't reinvent that).
 *   2. Override three things on top of the utility policy:
 *        a. Upgrade priority — hand-picked ordering biased for the infinite
 *           phase (heavy survival + chain-AoE effects) instead of the generic
 *           category scorer.
 *        b. Center-bias movement guard — if drifting toward a world edge,
 *           pull back. Phase 4 spawnDist drops to 200px, so hugging a wall
 *           means enemies spawn on us.
 *        c. Behavior-aware aim (summoner / shooter priority) and dash evasion
 *           (strategist already does this — we keep it).
 *   3. Keep attack eagerness high — weapon cooldown is the throughput ceiling.
 *
 * We wrap strategist's combat layer rather than reimplement it: the utility
 * policy's intention/candidate scoring has been tuned against the full enemy
 * mix and handles corner cases (flanker wrap-around, ambusher reveal) we
 * couldn't cover by hand without a lot of iteration.
 */

import { registerPolicy } from '../../../ai/policy-types.js';
import { createUtilityPolicy, mergeWeights } from '../create-utility-policy.js';
import { BRAWLER_WEIGHTS } from './brawler.js';

// Start from brawler weights — the aggressive cluster-collapser that beats
// the other utility variants at the 30k-tick bench. Nudges:
//   - flee / kite / hold_range slightly up: kill_shockwave still chains while
//     the player is at the CLUSTER EDGE, so we don't need to be dead-center.
//     Sitting at the edge + stepping in periodically is a longer-lived mix.
//   - retreatThreshold 0.25 so we start fleeing before a 2-tick burst combo
//     deletes us. 0.15 (brawler) is too late for phase-4 chargers.
//   - attackEagerness 2.0 — we want every possible weapon swing to fire.
const OBLITERATOR_WEIGHTS = mergeWeights(BRAWLER_WEIGHTS, {
  flee: 0.5,
  kite: 0.5,
  hold_range: 0.7,
  retreatThreshold: 0.25,
  damageRiskTolerance: 0.6,
  attackEagerness: 2.0,
  upgradeWeights: {
    survivability: 1.5,
    damage: 2.0,
    aoe: 2.2,
    speed: 0.5,
    utility: 0.5,
    scaling: 1.6,
  },
});

// Behavior-aware constants (mirror strategist).
const DASH_EVADE_RADIUS = 120;
const PRIORITY_AIM_RADIUS = 380;
// Edge-of-world safety band. Below this distance to any wall, bias the
// movement vector back toward the map center. Phase 4's spawnDist floor is
// 200 and maxConcurrent is 500+, so being pushed into a corner means
// enemies literally materialize on top of the player.
const EDGE_WARNING = 280;
const WORLD_CENTER_X = 2048;
const WORLD_CENTER_Y = 2048;

// Upgrade priority ladders. Stack caps come from UPGRADE_POOL in
// src/content/upgrade-pool.js — we duplicate them here so this file is
// self-contained and doesn't crash if that module shape changes.
const WEAPON_PRIORITY = [
  // Sword with mastery (0.8× cooldown, +0.4 cone angle) = 0.4s swings in a
  // wide arc. The stun (0.25s at 15% speed) also freezes phase-3 chargers
  // mid-dash which is our best answer to the 18-damage one-shot. We tested
  // shotgun (poor DPS) and nova (too slow early — died in phase 1) and sword
  // beat both by 5× total kills.
  'sword_mastery',
  'shotgun_unlock',
  'nova_unlock',
];
const SIGNATURE_PRIORITY = [
  // kill_shockwave is the dominant pick: each kill triggers a radial AoE
  // burst that chain-kills other enemies, creating explosive feedback loops
  // in dense phase-4 crowds.
  'kill_shockwave',
  'berserker',    // +80% fire rate below 50% HP
  'focus_fire',   // +60% damage while still — marginal while kiting
  'pierce',       // only helps projectile weapons
];

// Tier-3 priority. Survival first so we live through the phase-3→4
// transition (strategist dies right here), then damage/scaling kickers.
// The exact ordering matters a lot — moving explosive_fifth ahead of
// armor_thorns drops total kills because we die before the AoE amp pays off.
const POWER_PRIORITY = [
  { id: 'armor_thorns',    cap: 2 },   // passive AoE + armor, stackable ×2
  { id: 'regen_1',         cap: 1 },   // 2 HP/s passive healing
  { id: 'hp_1',            cap: 2 },   // +60 max HP buffer
  { id: 'vampiric',        cap: 2 },   // 3 HP/kill × 2 = scale with kills
  { id: 'explosive_fifth', cap: 1 },   // every 5th hit explodes (AoE amp)
  { id: 'regen_1',         cap: 2 },   // stack regen second
  { id: 'damage_1',        cap: 3 },   // +72% multiplicative damage
  { id: 'hp_1',            cap: 4 },   // more HP pool for late game
  { id: 'speed_on_kill',   cap: 1 },   // +30% speed on kill (2s)
  { id: 'speed_1',         cap: 2 },   // +15% speed × 2
  { id: 'magnet_1',        cap: 1 },   // XP pickup heal
  { id: 'heal_now',        cap: 99 },  // handled above at hpRatio<0.5
];

function createObliteratorPolicy(overrides = {}) {
  const weights = mergeWeights(OBLITERATOR_WEIGHTS, overrides);
  const base = createUtilityPolicy('Obliterator', 'obliterator', weights);

  return {
    ...base,

    // Override act() to layer center-bias, dash evasion, priority aim, and
    // a hard panic override on top of the utility policy's movement.
    act(obs) {
      const action = base.act(obs);

      // Priority aim: summoners/shooters in weapon range get the shot.
      const priority = pickPriorityTarget(obs);
      if (priority
          && obs.weaponReady
          && priority.dist <= obs.weaponRange * 0.95) {
        action.targetX = priority.x;
        action.targetY = priority.y;
        action.attack = 1;
      }

      // Dash evasion: charger in dash phase, perpendicular strafe.
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

      // Hard panic override — at very low HP, forget the utility planner's
      // commitment and flee toward the safest sector blended with center
      // bias. Utility policy's hysteresis locks into intentions for 15
      // ticks, which is fine normally but dangerous when a charger dash +
      // shooter volley arrives in the same window during phase 4.
      if (obs.hpRatio < 0.22) {
        const toCenterX = WORLD_CENTER_X - obs.playerX;
        const toCenterY = WORLD_CENTER_Y - obs.playerY;
        const cd = Math.hypot(toCenterX, toCenterY) || 1;
        // Mix: 60% safestDir (sector scoring from observations) + 40% toward
        // center. safestDir gives us the low-threat vector; center bias
        // keeps us out of spawn-on-us wall deaths.
        let fx = obs.safestDirX * 0.6 + (toCenterX / cd) * 0.4;
        let fy = obs.safestDirY * 0.6 + (toCenterY / cd) * 0.4;
        const fl = Math.hypot(fx, fy) || 1;
        action.dx = fx / fl;
        action.dy = fy / fl;
      }

      // Edge safety: if we're getting pushed toward a wall, blend in a
      // center-ward bias. Don't hard-override — the utility planner picked
      // this direction for a reason (probably fleeing a cluster). Just
      // nudge it so we don't commit to a wall hug.
      const edgeDist = Math.min(
        obs.playerX,
        obs.playerY,
        obs.worldW - obs.playerX,
        obs.worldH - obs.playerY,
      );
      if (edgeDist < EDGE_WARNING) {
        const toCenterX = WORLD_CENTER_X - obs.playerX;
        const toCenterY = WORLD_CENTER_Y - obs.playerY;
        const cd = Math.hypot(toCenterX, toCenterY) || 1;
        const cx = toCenterX / cd;
        const cy = toCenterY / cd;
        // The closer to the wall, the stronger the center pull. At the
        // wall itself (edgeDist ~ 0) center bias is 1.0.
        const urgency = 1 - edgeDist / EDGE_WARNING;
        const blend = Math.min(1, urgency * 1.2);
        let mx = action.dx * (1 - blend) + cx * blend;
        let my = action.dy * (1 - blend) + cy * blend;
        const ml = Math.hypot(mx, my) || 1;
        action.dx = mx / ml;
        action.dy = my / ml;
      }

      return action;
    },

    // Override chooseUpgrade with a hand-ordered priority list.
    chooseUpgrade(choices, obs) {
      if (!choices || choices.length === 0) return null;

      const level = obs.level || 1;
      const acquired = obs.acquiredUpgrades || [];
      const hpRatio = obs.hpRatio != null ? obs.hpRatio : 1;
      const stackCount = (id) => acquired.filter(x => x === id).length;

      // Emergency heal_now — grab it whenever we're hurt enough that the
      // full instant heal is net-positive vs the opportunity cost of a
      // regular power pick. 50% is the break-even: 25% instant heal == one
      // regen_1 stack's passive healing over ~30s.
      if (hpRatio < 0.5) {
        const heal = choices.find(x => x.id === 'heal_now');
        if (heal) return heal.id;
      }

      // Tier 1 & 2 picks come from specific ladders.
      if (level === 1) {
        for (const id of WEAPON_PRIORITY) {
          const c = choices.find(x => x.id === id);
          if (c) return c.id;
        }
        return choices[0].id;
      }
      if (level === 2) {
        for (const id of SIGNATURE_PRIORITY) {
          const c = choices.find(x => x.id === id);
          if (c) return c.id;
        }
        return choices[0].id;
      }

      // Tier 3+: dynamic priority with stack awareness.
      for (const { id, cap } of POWER_PRIORITY) {
        if (stackCount(id) >= cap) continue;
        const c = choices.find(x => x.id === id);
        if (c) return c.id;
      }

      // Fallback: anything we can still stack.
      for (const c of choices) {
        const cap = c.maxStacks || 1;
        if (stackCount(c.id) < cap) return c.id;
      }
      return choices[0].id;
    },
  };
}

function pickPriorityTarget(obs) {
  if (obs.nearestSummoner && obs.nearestSummoner.dist <= PRIORITY_AIM_RADIUS) {
    return obs.nearestSummoner;
  }
  if (obs.nearestShooter && obs.nearestShooter.dist <= PRIORITY_AIM_RADIUS) {
    return obs.nearestShooter;
  }
  return null;
}

registerPolicy('obliterator', createObliteratorPolicy);

export { createObliteratorPolicy, OBLITERATOR_WEIGHTS };
