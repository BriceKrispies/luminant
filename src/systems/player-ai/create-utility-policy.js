import { createSensors } from './sensors.js';
import { createUtilityScorer } from './utility-scorer.js';
import { createMovementPlanner } from './movement-planner.js';
import { createUpgradeStrategy } from './upgrade-strategy.js';

export function createUtilityPolicy(name, id, weights) {
  const sensors = createSensors();
  const scorer = createUtilityScorer();
  const planner = createMovementPlanner({
    commitmentTime: weights.commitmentTime || 8,
    smoothingRate: weights.smoothingRate || 0.3,
    intentionHysteresis: weights.intentionHysteresis || 0.15,
    attackEagerness: weights.attackEagerness || 1.0,
  });
  const upgrader = createUpgradeStrategy(weights);

  return {
    name,
    id,
    params: weights,
    _utilityPolicy: true,

    reset() {
      sensors.reset();
      planner.reset();
    },

    act(obs) {
      const sensorData = sensors.sense(obs);
      const scored = scorer.score(sensorData, weights);
      return planner.plan(scored, sensorData);
    },

    chooseUpgrade(choices, obs) {
      return upgrader.choose(choices, obs);
    },

    metadata() {
      return { intention: planner.currentIntention };
    },
  };
}

export function mergeWeights(base, overrides) {
  const merged = { ...base, ...overrides };
  if (overrides.upgradeWeights) {
    merged.upgradeWeights = { ...base.upgradeWeights, ...overrides.upgradeWeights };
  }
  return merged;
}
