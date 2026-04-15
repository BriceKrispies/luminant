/**
 * Lab bot policy system.
 * Configurable weight-based policies for simulation experimentation.
 *
 * Wraps the existing utility AI pipeline with lab-specific features:
 * - Named bias presets (survival, XP, distance, AOE, elite, caution)
 * - Mutation for evolutionary search
 * - Serializable configs for recording/replay
 *
 * Does NOT replace the existing policy system — registers lab policies
 * through the standard registerPolicy() pathway.
 */

import { registerPolicy } from '../ai/policy-types.js';
import { createUtilityPolicy, mergeWeights } from '../systems/player-ai/create-utility-policy.js';

// ── Bias presets ──
// Each preset is a partial weight override emphasizing one behavior.

export const BIAS_PRESETS = {
  survival: {
    flee: 2.0,
    kite: 1.8,
    hold_range: 1.5,
    collapse_on_cluster: 0.3,
    maintain_pressure: 0.4,
    retreatThreshold: 0.4,
    damageRiskTolerance: 0.2,
    survivalBias: 0.9,
    dangerWeight: 2.0,
    rewardWeight: 0.5,
    upgradeWeights: { survivability: 2.5, damage: 0.5, aoe: 0.5, speed: 1.5, utility: 0.8, scaling: 0.5 },
  },
  xp_collection: {
    collect_xp: 2.5,
    maintain_pressure: 1.5,
    collapse_on_cluster: 1.0,
    greedBias: 0.9,
    pickupGreed: 0.9,
    rewardWeight: 2.0,
    upgradeWeights: { survivability: 0.8, damage: 1.0, aoe: 1.5, speed: 1.0, utility: 2.5, scaling: 1.5 },
  },
  keep_distance: {
    kite: 2.5,
    hold_range: 2.0,
    flee: 1.5,
    maintain_pressure: 0.3,
    collapse_on_cluster: 0.2,
    preferredSpacing: 1.8,
    dangerWeight: 2.0,
    upgradeWeights: { survivability: 1.5, damage: 1.0, aoe: 0.5, speed: 2.0, utility: 1.0, scaling: 1.0 },
  },
  aoe_opportunity: {
    collapse_on_cluster: 2.5,
    maintain_pressure: 2.0,
    clusterPreference: 0.9,
    attackEagerness: 2.0,
    damageRiskTolerance: 0.7,
    upgradeWeights: { survivability: 0.8, damage: 1.5, aoe: 2.5, speed: 0.5, utility: 1.0, scaling: 1.5 },
  },
  elite_targeting: {
    boss_focus: 3.0,
    bossFocus: 0.9,
    maintain_pressure: 1.5,
    hold_range: 1.5,
    damageRiskTolerance: 0.5,
    upgradeWeights: { survivability: 1.0, damage: 2.5, aoe: 1.0, speed: 1.0, utility: 0.5, scaling: 1.5 },
  },
  low_hp_caution: {
    flee: 1.5,
    kite: 1.5,
    retreatThreshold: 0.5,
    damageRiskTolerance: 0.15,
    survivalBias: 0.8,
    dangerWeight: 1.5,
    upgradeWeights: { survivability: 2.0, damage: 0.8, aoe: 0.8, speed: 1.5, utility: 1.0, scaling: 0.8 },
  },
};

/** Base weights — balanced starting point for lab bots */
const LAB_BASE_WEIGHTS = {
  flee: 1.0,
  kite: 1.0,
  hold_range: 1.0,
  reposition_for_shot: 1.0,
  collapse_on_cluster: 1.0,
  collect_xp: 1.0,
  boss_focus: 1.0,
  maintain_pressure: 1.0,
  hold_ground: 0.5,

  dangerWeight: 1.0,
  rewardWeight: 1.0,

  survivalBias: 0.5,
  greedBias: 0.5,
  preferredSpacing: 1.0,
  pickupGreed: 0.5,
  clusterPreference: 0.5,
  bossFocus: 0.5,
  commitmentTime: 10,
  smoothingRate: 0.3,
  intentionHysteresis: 0.15,
  retreatThreshold: 0.3,
  damageRiskTolerance: 0.5,
  attackEagerness: 1.0,

  upgradeWeights: {
    survivability: 1.0,
    damage: 1.0,
    aoe: 1.0,
    speed: 1.0,
    utility: 1.0,
    scaling: 1.0,
  },
};

/** All mutable weight keys (flat, excludes nested upgradeWeights) */
const MUTABLE_KEYS = [
  'flee', 'kite', 'hold_range', 'reposition_for_shot',
  'collapse_on_cluster', 'collect_xp', 'boss_focus',
  'maintain_pressure', 'hold_ground',
  'dangerWeight', 'rewardWeight',
  'survivalBias', 'greedBias', 'preferredSpacing', 'pickupGreed',
  'clusterPreference', 'bossFocus', 'commitmentTime', 'smoothingRate',
  'intentionHysteresis', 'retreatThreshold', 'damageRiskTolerance',
  'attackEagerness',
];

const MUTABLE_UPGRADE_KEYS = [
  'survivability', 'damage', 'aoe', 'speed', 'utility', 'scaling',
];

/** Weight ranges for mutation clamping */
const WEIGHT_RANGES = {
  flee: [0, 4], kite: [0, 4], hold_range: [0, 4],
  reposition_for_shot: [0, 4], collapse_on_cluster: [0, 4],
  collect_xp: [0, 4], boss_focus: [0, 5], maintain_pressure: [0, 4],
  hold_ground: [0, 3],
  dangerWeight: [0, 4], rewardWeight: [0, 4],
  survivalBias: [0, 1], greedBias: [0, 1], preferredSpacing: [0.3, 3],
  pickupGreed: [0, 1], clusterPreference: [0, 1], bossFocus: [0, 1],
  commitmentTime: [3, 30], smoothingRate: [0.05, 0.8],
  intentionHysteresis: [0, 0.5], retreatThreshold: [0.05, 0.7],
  damageRiskTolerance: [0, 1], attackEagerness: [0.2, 3],
  // upgrade sub-weights
  survivability: [0, 3], damage: [0, 3], aoe: [0, 3],
  speed: [0, 3], utility: [0, 3], scaling: [0, 3],
};

/**
 * Create a lab bot config from optional bias presets + overrides.
 *
 * @param {Object} options
 * @param {string} [options.name] — bot name
 * @param {string[]} [options.biases] — preset names to layer on
 * @param {Object} [options.overrides] — direct weight overrides
 * @returns {Object} — { name, weights } serializable config
 */
export function createBotConfig(options = {}) {
  const { name = 'lab-bot', biases = [], overrides = {} } = options;

  let weights = { ...LAB_BASE_WEIGHTS, upgradeWeights: { ...LAB_BASE_WEIGHTS.upgradeWeights } };

  // Layer bias presets
  for (const biasName of biases) {
    const preset = BIAS_PRESETS[biasName];
    if (!preset) continue;
    weights = mergeWeights(weights, preset);
  }

  // Apply direct overrides
  if (Object.keys(overrides).length > 0) {
    weights = mergeWeights(weights, overrides);
  }

  return { name, biases: [...biases], weights };
}

/**
 * Create a policy instance from a bot config.
 * @param {Object} config — from createBotConfig
 * @returns {PolicyInterface}
 */
export function createBotPolicy(config) {
  const id = `lab-${config.name}`;
  return createUtilityPolicy(config.name, id, config.weights);
}

/**
 * Mutate a bot config to produce a child variant.
 * Does NOT modify the parent config.
 *
 * @param {Object} parentConfig — from createBotConfig
 * @param {Object} [options]
 * @param {number} [options.mutationRate=0.3] — fraction of keys to mutate
 * @param {number} [options.mutationScale=0.15] — magnitude as fraction of range
 * @param {function} [options.rng=Math.random] — RNG function for determinism
 * @returns {Object} — new bot config (child)
 */
export function mutateBotConfig(parentConfig, options = {}) {
  const {
    mutationRate = 0.3,
    mutationScale = 0.15,
    rng = Math.random,
  } = options;

  const parentWeights = parentConfig.weights;
  const childWeights = {
    ...parentWeights,
    upgradeWeights: { ...parentWeights.upgradeWeights },
  };

  // Mutate flat keys
  for (const key of MUTABLE_KEYS) {
    if (rng() > mutationRate) continue;
    const [min, max] = WEIGHT_RANGES[key] || [0, 3];
    const range = max - min;
    const delta = (rng() * 2 - 1) * range * mutationScale;
    childWeights[key] = clamp(
      (childWeights[key] || 0) + delta, min, max
    );
    childWeights[key] = round3(childWeights[key]);
  }

  // Mutate upgrade weights
  for (const key of MUTABLE_UPGRADE_KEYS) {
    if (rng() > mutationRate) continue;
    const [min, max] = WEIGHT_RANGES[key] || [0, 3];
    const range = max - min;
    const delta = (rng() * 2 - 1) * range * mutationScale;
    childWeights.upgradeWeights[key] = clamp(
      (childWeights.upgradeWeights[key] || 0) + delta, min, max
    );
    childWeights.upgradeWeights[key] = round3(childWeights.upgradeWeights[key]);
  }

  return {
    name: parentConfig.name + '-m',
    biases: [...(parentConfig.biases || [])],
    weights: childWeights,
  };
}

/**
 * Serialize a bot config to a plain JSON-friendly object.
 */
export function serializeBotConfig(config) {
  return {
    name: config.name,
    biases: config.biases || [],
    weights: {
      ...config.weights,
      upgradeWeights: { ...config.weights.upgradeWeights },
    },
  };
}

/**
 * Deserialize a bot config from JSON.
 */
export function deserializeBotConfig(json) {
  return {
    name: json.name,
    biases: json.biases || [],
    weights: {
      ...LAB_BASE_WEIGHTS,
      ...json.weights,
      upgradeWeights: {
        ...LAB_BASE_WEIGHTS.upgradeWeights,
        ...(json.weights?.upgradeWeights || {}),
      },
    },
  };
}

// Register a generic lab-bot policy factory
registerPolicy('lab-bot', (params = {}) => {
  const config = createBotConfig({
    name: params.name || 'lab-bot',
    biases: params.biases || [],
    overrides: params,
  });
  return createBotPolicy(config);
});

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function round3(v) { return Math.round(v * 1000) / 1000; }

export { LAB_BASE_WEIGHTS, MUTABLE_KEYS, MUTABLE_UPGRADE_KEYS, WEIGHT_RANGES };
