import { createObservationBuilder } from '../ai/observations.js';
import { createPolicy, listPolicies } from '../ai/policy-types.js';

// Register policies
import './player-ai/policies/brawler.js';
import './player-ai/policies/strategist.js';
import '../ai/neural/neural-policy.js';

export function createPlayerAISystem(engine) {
  let enabled = false;
  let policy = null;
  let obsBuilder = null;
  let ctx = {};
  let debugData = null;

  return {
    get enabled() { return enabled; },
    set enabled(v) { enabled = v; },

    get policy() { return policy; },
    get policyName() { return policy ? policy.name : 'none'; },
    get policyId() { return policy ? policy.id : 'none'; },

    get debugData() { return debugData; },

    setPolicy(policyOrId, params) {
      if (typeof policyOrId === 'string') {
        policy = createPolicy(policyOrId, params);
      } else {
        policy = policyOrId;
      }
      obsBuilder = createObservationBuilder(engine);
    },

    listPolicies() {
      return listPolicies();
    },

    setContext(gameCtx) {
      ctx = gameCtx;
    },

    update(playerX, playerY) {
      if (!enabled || !policy || !obsBuilder) return null;

      const obs = obsBuilder.build({
        playerX,
        playerY,
        ...ctx,
      });

      const action = policy.act(obs);

      this._lastObs = obs;
      this._lastAction = action;

      // Capture debug data from policies
      if (action._intention) {
        debugData = {
          intention: action._intention,
          intentionScores: action._intentionScores,
          topCandidates: action._topCandidates,
          danger: action._danger,
          encirclement: action._encirclement,
          preferredRange: action._preferredRange,
        };
      } else if (action._neuralDebug) {
        debugData = action._neuralDebug;
      } else {
        debugData = null;
      }

      return action;
    },

    chooseUpgrade(choices) {
      if (!policy || !obsBuilder) {
        return choices.length > 0 ? choices[0].id : null;
      }
      const obs = this._lastObs || obsBuilder.build(ctx);
      return policy.chooseUpgrade(choices, obs);
    },

    _lastObs: null,
    _lastAction: null,

    reset() {
      if (policy) policy.reset();
      if (obsBuilder) obsBuilder.reset();
      this._lastObs = null;
      this._lastAction = null;
      debugData = null;
    },
  };
}
