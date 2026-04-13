/**
 * Fitness / reward scoring for evaluating simulation runs.
 * Centralized and tunable — not buried in policy code.
 *
 * Combines survival time, XP, level, kills, wave progress,
 * and efficiency metrics into a single score.
 */

/** Default scoring weights — easy to tune */
export const DEFAULT_SCORE_WEIGHTS = {
  survivalTime: 1.0,       // per second survived
  level: 50,               // per level reached
  kills: 0.1,              // per kill
  xp: 0.05,                // per XP earned
  wave: 100,               // per wave/phase reached
  damageEfficiency: 20,    // bonus for high kill/damage-taken ratio
  deathPenalty: -200,       // flat penalty for dying (vs surviving max)
};

/**
 * Compute a run's fitness score.
 *
 * @param {Object} result — structured run result
 * @param {number} result.survivalTime — seconds survived
 * @param {number} result.level — final level
 * @param {number} result.kills — total kills
 * @param {number} result.totalXP — total XP earned
 * @param {number} result.wave — wave/phase reached
 * @param {number} result.damageTaken — total damage taken
 * @param {boolean} result.survived — true if still alive at max ticks
 * @param {Object} [weights] — override default weights
 * @returns {number} — fitness score
 */
export function computeScore(result, weights = DEFAULT_SCORE_WEIGHTS) {
  const w = { ...DEFAULT_SCORE_WEIGHTS, ...weights };

  let score = 0;

  score += result.survivalTime * w.survivalTime;
  score += result.level * w.level;
  score += result.kills * w.kills;
  score += (result.totalXP || 0) * w.xp;
  score += result.wave * w.wave;

  // Damage efficiency: ratio of kills to damage taken
  const damageTaken = result.damageTaken || 1;
  const efficiency = result.kills / Math.max(damageTaken, 1);
  score += efficiency * w.damageEfficiency;

  // Death penalty (only if we died before max time)
  if (!result.survived) {
    score += w.deathPenalty;
  }

  return Math.round(score * 100) / 100;
}

/**
 * Compare two results — for sorting (higher score first).
 */
export function compareResults(a, b) {
  return b.score - a.score;
}

/**
 * Compute aggregate statistics over an array of scored results.
 */
export function aggregateResults(results) {
  if (results.length === 0) return null;

  const scores = results.map(r => r.score);
  const times = results.map(r => r.survivalTime);
  const levels = results.map(r => r.level);
  const kills = results.map(r => r.kills);

  const sorted = [...scores].sort((a, b) => a - b);

  return {
    count: results.length,
    bestScore: Math.max(...scores),
    worstScore: Math.min(...scores),
    medianScore: sorted[Math.floor(sorted.length / 2)],
    meanScore: mean(scores),
    stdScore: std(scores),
    avgSurvivalTime: mean(times),
    avgLevel: mean(levels),
    avgKills: mean(kills),
    maxLevel: Math.max(...levels),
    maxKills: Math.max(...kills),
    maxSurvivalTime: Math.max(...times),
    survivedCount: results.filter(r => r.survived).length,
  };
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr) {
  const m = mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}
