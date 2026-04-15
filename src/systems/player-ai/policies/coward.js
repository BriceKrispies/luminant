import { registerPolicy } from '../../../ai/policy-types.js';
import { createUtilityPolicy, mergeWeights } from '../create-utility-policy.js';

const COWARD_WEIGHTS = {
  flee: 2.5,
  kite: 1.5,
  hold_range: 1.0,
  reposition_for_shot: 0.5,
  collapse_on_cluster: 0.1,
  collect_xp: 0.8,
  boss_focus: 0.2,
  maintain_pressure: 0.3,
  hold_ground: 0.5,

  dangerWeight: 2.0,
  rewardWeight: 0.5,

  survivalBias: 0.9,
  greedBias: 0.1,
  preferredSpacing: 1.3,
  pickupGreed: 0.3,
  clusterPreference: 0.1,
  bossFocus: 0.1,
  commitmentTime: 5,
  smoothingRate: 0.35,
  intentionHysteresis: 0.1,
  retreatThreshold: 0.5,
  damageRiskTolerance: 0.1,
  attackEagerness: 0.5,

  upgradeWeights: {
    survivability: 2.5,
    damage: 0.3,
    aoe: 0.4,
    speed: 2.0,
    utility: 0.8,
    scaling: 0.5,
  },
};

function createCowardPolicy(overrides = {}) {
  return createUtilityPolicy('Coward', 'coward', mergeWeights(COWARD_WEIGHTS, overrides));
}

registerPolicy('coward', createCowardPolicy);

export { createCowardPolicy, COWARD_WEIGHTS };
