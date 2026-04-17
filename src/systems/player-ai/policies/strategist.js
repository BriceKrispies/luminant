/**
 * Strategist policy — behavior-aware utility policy.
 *
 * Wraps the base utility policy and injects three behavior-aware overrides
 * that the stock sensor/scorer layers can't express:
 *
 *   1. Summoner priority targeting — summoners spawn minions on a timer, so
 *      one kill removes many future enemies. Whenever a summoner is in weapon
 *      range, aim at it and attack even if the generic scorer picked a
 *      different target.
 *   2. Shooter priority targeting — shooters sit at range and chip HP. Close
 *      the gap on them and prefer aiming at them over nearest pursuers.
 *   3. Dash evasion — if a charger is in its dash sub-phase and closing on
 *      the player, override movement with a perpendicular strafe to sidestep
 *      the strike. This is the one enemy whose telegraph is readable in
 *      observation state.
 *
 * Weights are tuned to be more survival-biased than brawler since the 10
 * behavior mix is harsher: lower retreat threshold, lower
 * damageRiskTolerance, slightly higher flee weight, more AoE in upgrades.
 */

import { registerPolicy } from '../../../ai/policy-types.js';
import { createUtilityPolicy, mergeWeights } from '../create-utility-policy.js';
import { BRAWLER_WEIGHTS } from './brawler.js';

// Start from brawler (proven best at 30k-tick bench) and make small targeted
// nudges: slightly more defensive retreat thresholds, a bit more AoE weight
// so summoners don't snowball. The behavior-aware logic is in `act()`.
const STRATEGIST_WEIGHTS = mergeWeights(BRAWLER_WEIGHTS, {
  flee: 0.4,
  retreatThreshold: 0.2,
  damageRiskTolerance: 0.7,
  upgradeWeights: {
    aoe: 2.0,
    scaling: 1.7,
  },
});

// How close a charger dash has to be before we override movement to dodge.
const DASH_EVADE_RADIUS = 120;
// How close a priority target has to be before we re-aim at it.
const PRIORITY_AIM_RADIUS = 380;

function createStrategistPolicy(overrides = {}) {
  const weights = mergeWeights(STRATEGIST_WEIGHTS, overrides);
  const base = createUtilityPolicy('Strategist', 'strategist', weights);

  return {
    ...base,
    act(obs) {
      const action = base.act(obs);

      // Re-aim at summoner/shooter ONLY if they're already in range and the
      // weapon is ready. Avoids pulling the cone off an active cluster.
      const priority = pickPriorityTarget(obs);
      if (priority
          && obs.weaponReady
          && priority.dist <= obs.weaponRange * 0.95) {
        action.targetX = priority.x;
        action.targetY = priority.y;
        action.attack = 1;
      }

      // Dash evasion — if a charger is in its dash phase and close, strafe.
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
  };
}

function pickPriorityTarget(obs) {
  const summoner = obs.nearestSummoner;
  if (summoner && summoner.dist <= PRIORITY_AIM_RADIUS) return summoner;
  const shooter = obs.nearestShooter;
  if (shooter && shooter.dist <= PRIORITY_AIM_RADIUS) return shooter;
  return null;
}

registerPolicy('strategist', createStrategistPolicy);

export { createStrategistPolicy, STRATEGIST_WEIGHTS };
