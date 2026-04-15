import { registerPolicy } from '../../../ai/policy-types.js';
import { createUtilityPolicy, mergeWeights } from '../create-utility-policy.js';

const FARMER_WEIGHTS = {
  flee: 1.0,
  kite: 0.8,
  hold_range: 0.8,
  reposition_for_shot: 0.5,
  collapse_on_cluster: 1.0,
  collect_xp: 3.0,
  boss_focus: 0.3,
  maintain_pressure: 0.8,
  hold_ground: 0.2,

  dangerWeight: 1.0,
  rewardWeight: 2.0,

  survivalBias: 0.4,
  greedBias: 0.9,
  preferredSpacing: 0.9,
  pickupGreed: 0.9,
  clusterPreference: 0.5,
  bossFocus: 0.2,
  commitmentTime: 6,
  smoothingRate: 0.35,
  intentionHysteresis: 0.1,
  retreatThreshold: 0.3,
  damageRiskTolerance: 0.5,
  attackEagerness: 0.8,

  upgradeWeights: {
    survivability: 0.5,
    damage: 1.0,
    aoe: 1.5,
    speed: 1.2,
    utility: 2.5,
    scaling: 1.8,
  },
};

function createFarmerPolicy(overrides = {}) {
  return createUtilityPolicy('Farmer', 'farmer', mergeWeights(FARMER_WEIGHTS, overrides));
}

registerPolicy('farmer', createFarmerPolicy);

export { createFarmerPolicy, FARMER_WEIGHTS };
