/**
 * Upgrade decision strategies.
 * Separate from movement policies — can be mixed and matched.
 *
 * Each strategy receives:
 *   - choices: array of upgrade objects from the pool
 *   - observation: current game observation
 *   - acquired: list of already-picked upgrade IDs
 *
 * Returns the chosen upgrade ID.
 */

/**
 * @typedef {Object} UpgradeWeights
 * @property {number} survivability — HP, armor, regen, heal
 * @property {number} damage — damage multipliers, cooldown reduction
 * @property {number} aoe — area effects, shockwave, nova
 * @property {number} speed — movement speed, adrenaline
 * @property {number} utility — pickup radius, magnet, pierce
 * @property {number} scaling — effects that grow over time
 */

/** Default weight set for balanced play */
export const BALANCED_WEIGHTS = {
  survivability: 1.0,
  damage: 1.0,
  aoe: 1.0,
  speed: 1.0,
  utility: 1.0,
  scaling: 1.0,
};

/** Weights that prioritize not dying */
export const DEFENSIVE_WEIGHTS = {
  survivability: 2.0,
  damage: 0.5,
  aoe: 0.6,
  speed: 1.5,
  utility: 0.8,
  scaling: 0.5,
};

/** Weights that prioritize kill speed */
export const AGGRESSIVE_WEIGHTS = {
  survivability: 0.3,
  damage: 2.0,
  aoe: 2.0,
  speed: 0.8,
  utility: 1.0,
  scaling: 1.5,
};

/** Weights that prioritize XP farming */
export const FARMING_WEIGHTS = {
  survivability: 0.8,
  damage: 1.0,
  aoe: 1.5,
  speed: 1.0,
  utility: 2.0,
  scaling: 1.5,
};

/** Named preset map */
export const WEIGHT_PRESETS = {
  balanced: BALANCED_WEIGHTS,
  defensive: DEFENSIVE_WEIGHTS,
  aggressive: AGGRESSIVE_WEIGHTS,
  farming: FARMING_WEIGHTS,
};

/**
 * Score a single upgrade choice given weights and game state.
 * Returns a numeric score (higher = better).
 */
export function scoreUpgrade(choice, weights, obs) {
  let score = 0;
  const w = weights;

  // Survivability
  if (choice.maxHpBonus) score += w.survivability * 2;
  if (choice.armor) score += w.survivability * 1.5;
  if (choice.regenRate) score += w.survivability * 2;
  if (choice.healOnPickup) {
    score += w.survivability * (obs.hpRatio < 0.5 ? 3 : 1);
  }
  if (choice.healPerKill) score += w.survivability * 1.2;
  if (choice.effect === 'thorns') score += w.survivability * 1.5;

  // Damage
  if (choice.damageMultiplier && choice.damageMultiplier > 1) score += w.damage * 2;
  if (choice.cooldownMultiplier && choice.cooldownMultiplier < 1) score += w.damage * 1.8;
  if (choice.stunDurationBonus) score += w.damage * 0.8;
  if (choice.effect === 'focus_fire') score += w.damage * 1.5;
  if (choice.effect === 'berserker') score += w.damage * 1.8;

  // AoE
  if (choice.effect === 'kill_shockwave') score += w.aoe * 2.5;
  if (choice.effect === 'explosive_fifth') score += w.aoe * 2;
  if (choice.weapon === 'nova') score += w.aoe * 2;
  if (choice.weapon === 'shotgun') score += w.aoe * 1.5;
  if (choice.weapon === 'sword' || choice.effect === 'sword_mastery') score += w.aoe * 1;

  // Speed
  if (choice.speedBonus) score += w.speed * 1.5;
  if (choice.effect === 'speed_on_kill') score += w.speed * 2;
  if (choice.effect === 'quick_dodge') score += w.speed * 1;

  // Utility
  if (choice.pickupRadius) score += w.utility * 1.5;
  if (choice.effect === 'magnet_heal') score += w.utility * 2;
  if (choice.pierceCount) score += w.utility * 1.5;

  // Scaling
  if (choice.effect === 'scaling_regen') score += w.scaling * (obs.level > 4 ? 2 : 1);
  if (choice.effect === 'vampiric') score += w.scaling * 1.5;

  // Context-sensitive adjustments
  if (obs.hpRatio < 0.3 && choice.healOnPickup) score += 2;
  if (obs.level >= 5 && choice.maxStacks > 1 && obs.acquiredUpgrades.includes(choice.id)) {
    score *= 1.25; // stacking bonus in late game
  }

  return score;
}

/**
 * Choose the best upgrade from a list of choices.
 * @param {Array} choices — upgrade objects
 * @param {UpgradeWeights} weights
 * @param {Observation} obs
 * @returns {string} — chosen upgrade id
 */
export function chooseUpgrade(choices, weights, obs) {
  if (choices.length === 0) return null;

  let bestId = choices[0].id;
  let bestScore = -Infinity;

  for (const c of choices) {
    const s = scoreUpgrade(c, weights, obs);
    if (s > bestScore) {
      bestScore = s;
      bestId = c.id;
    }
  }

  return bestId;
}
