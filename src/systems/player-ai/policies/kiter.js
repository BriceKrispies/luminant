import { registerPolicy } from '../../../ai/policy-types.js';
import { createUtilityPolicy, mergeWeights } from '../create-utility-policy.js';

const KITER_WEIGHTS = {
  flee: 1.0,
  kite: 2.5,
  hold_range: 2.0,
  reposition_for_shot: 1.5,
  collapse_on_cluster: 0.3,
  collect_xp: 0.7,
  boss_focus: 0.8,
  maintain_pressure: 1.0,
  hold_ground: 0.3,

  dangerWeight: 1.2,
  rewardWeight: 0.8,

  survivalBias: 0.5,
  greedBias: 0.3,
  preferredSpacing: 1.0,
  pickupGreed: 0.4,
  clusterPreference: 0.3,
  bossFocus: 0.5,
  commitmentTime: 10,
  smoothingRate: 0.3,
  intentionHysteresis: 0.15,
  retreatThreshold: 0.25,
  damageRiskTolerance: 0.4,
  attackEagerness: 0.9,

  upgradeWeights: {
    survivability: 0.8,
    damage: 1.5,
    aoe: 0.8,
    speed: 1.8,
    utility: 1.0,
    scaling: 1.0,
  },
};

function createKiterPolicy(overrides = {}) {
  return createUtilityPolicy('Kiter', 'kiter', mergeWeights(KITER_WEIGHTS, overrides));
}

registerPolicy('kiter', createKiterPolicy);

export { createKiterPolicy, KITER_WEIGHTS };
