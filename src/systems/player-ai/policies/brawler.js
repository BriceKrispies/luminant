import { registerPolicy } from '../../../ai/policy-types.js';
import { createUtilityPolicy, mergeWeights } from '../create-utility-policy.js';

const BRAWLER_WEIGHTS = {
  flee: 0.3,
  kite: 0.3,
  hold_range: 0.5,
  reposition_for_shot: 0.8,
  collapse_on_cluster: 2.0,
  collect_xp: 0.5,
  boss_focus: 1.5,
  maintain_pressure: 2.5,
  hold_ground: 1.0,

  dangerWeight: 0.4,
  rewardWeight: 1.5,

  survivalBias: 0.2,
  greedBias: 0.5,
  preferredSpacing: 0.7,
  pickupGreed: 0.3,
  clusterPreference: 0.8,
  bossFocus: 0.7,
  commitmentTime: 15,
  smoothingRate: 0.25,
  intentionHysteresis: 0.2,
  retreatThreshold: 0.15,
  damageRiskTolerance: 0.8,
  attackEagerness: 1.5,

  upgradeWeights: {
    survivability: 1.5,
    damage: 2.0,
    aoe: 1.8,
    speed: 0.5,
    utility: 0.5,
    scaling: 1.5,
  },
};

function createBrawlerPolicy(overrides = {}) {
  return createUtilityPolicy('Brawler', 'brawler', mergeWeights(BRAWLER_WEIGHTS, overrides));
}

registerPolicy('brawler', createBrawlerPolicy);

export { createBrawlerPolicy, BRAWLER_WEIGHTS };
