/**
 * Auto-player system.
 * Drives the player entity using a pluggable policy when Auto Mode is active.
 * Produces the same (dx, dy, attack, targetX, targetY) input the manual system does.
 *
 * The policy receives observations and returns actions — it never touches
 * engine state directly.
 */

import { createObservationBuilder } from '../ai/observations.js';
import { createPolicy, listPolicies } from '../ai/policy-types.js';

// Ensure built-in policies are registered
import '../ai/policies/survival.js';
import '../ai/policies/progression.js';

export function createAutoPlayerSystem(engine) {
  let enabled = false;
  let policy = null;
  let obsBuilder = null;

  // Game context — set by main loop each frame
  let ctx = {};

  return {
    get enabled() { return enabled; },
    set enabled(v) { enabled = v; },

    get policy() { return policy; },
    get policyName() { return policy ? policy.name : 'none'; },
    get policyId() { return policy ? policy.id : 'none'; },

    /** Set the active policy by id or instance */
    setPolicy(policyOrId, params) {
      if (typeof policyOrId === 'string') {
        policy = createPolicy(policyOrId, params);
      } else {
        policy = policyOrId;
      }
      obsBuilder = createObservationBuilder(engine);
    },

    /** List available policy IDs */
    listPolicies() {
      return listPolicies();
    },

    /**
     * Set game context for observation building.
     * Called by main loop each frame before update().
     */
    setContext(gameCtx) {
      ctx = gameCtx;
    },

    /**
     * Compute AI input for this frame.
     * Returns { dx, dy, attack, targetX, targetY } in the same shape
     * that manual input produces.
     */
    update(playerX, playerY) {
      if (!enabled || !policy || !obsBuilder) return null;

      const obs = obsBuilder.build({
        playerX,
        playerY,
        ...ctx,
      });

      const action = policy.act(obs);

      // Store last observation for debugging
      this._lastObs = obs;
      this._lastAction = action;

      return action;
    },

    /**
     * Choose an upgrade via the policy.
     * @param {Array} choices — upgrade objects
     * @returns {string} — chosen upgrade id
     */
    chooseUpgrade(choices) {
      if (!policy || !obsBuilder) {
        return choices.length > 0 ? choices[0].id : null;
      }
      const obs = this._lastObs || obsBuilder.build(ctx);
      return policy.chooseUpgrade(choices, obs);
    },

    /** Last observation (for debug overlay) */
    _lastObs: null,
    _lastAction: null,

    reset() {
      if (policy) policy.reset();
      if (obsBuilder) obsBuilder.reset();
      this._lastObs = null;
      this._lastAction = null;
    },
  };
}
