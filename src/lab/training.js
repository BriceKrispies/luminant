/**
 * Evolutionary training backend for experiment architecture.
 *
 * Manages population-based search over policy parameters:
 * - Population initialization from base params
 * - Candidate evaluation across multiple seeds
 * - Selection (truncation + tournament)
 * - Mutation with configurable rate/scale
 * - Elitism (top N carry forward unchanged)
 * - Random injection to prevent premature convergence
 * - Per-generation artifact production
 *
 * This module handles the evolutionary mechanics.
 * The experiment runner handles orchestration (wiring to game-runner, etc.).
 */

import { mutateBotConfig, createBotConfig } from './bot.js';
import { createGenerationArtifact } from './experiment.js';

/**
 * Create an initial population from a base config.
 *
 * @param {Object} baseConfig — bot config (from createBotConfig)
 * @param {number} populationSize
 * @param {Object} [options]
 * @param {number} [options.mutationRate=0.5] — initial diversity
 * @param {number} [options.mutationScale=0.2]
 * @param {function} [options.rng=Math.random]
 * @returns {Object[]} — array of bot configs
 */
export function initializePopulation(baseConfig, populationSize, options = {}) {
  const {
    mutationRate = 0.5,
    mutationScale = 0.2,
    rng = Math.random,
  } = options;

  const population = [baseConfig]; // First member is always the base

  for (let i = 1; i < populationSize; i++) {
    population.push(mutateBotConfig(baseConfig, {
      mutationRate,
      mutationScale,
      rng,
    }));
  }

  return population;
}

/**
 * Select the next generation from evaluated candidates.
 *
 * Strategy: keep elites unchanged, fill rest by mutating elites.
 * Optional random injection replaces some slots with fresh random configs.
 *
 * @param {Object[]} evaluatedCandidates — [{ config, avgReward }] sorted desc
 * @param {Object} params
 * @param {number} params.populationSize
 * @param {number} params.eliteCount
 * @param {number} params.mutationRate
 * @param {number} params.mutationScale
 * @param {number} [params.randomInjectionRate=0.1]
 * @param {Object} [params.baseConfig] — for random injection
 * @param {function} [params.rng=Math.random]
 * @returns {Object[]} — next generation population
 */
export function selectAndMutate(evaluatedCandidates, params) {
  const {
    populationSize,
    eliteCount,
    mutationRate,
    mutationScale,
    randomInjectionRate = 0.1,
    baseConfig,
    rng = Math.random,
  } = params;

  // Ensure sorted
  const sorted = [...evaluatedCandidates].sort((a, b) => b.avgReward - a.avgReward);
  const elites = sorted.slice(0, eliteCount).map(c => c.config);

  const nextGen = [...elites]; // Elites carry forward unchanged

  while (nextGen.length < populationSize) {
    // Random injection check
    if (baseConfig && rng() < randomInjectionRate) {
      nextGen.push(mutateBotConfig(baseConfig, {
        mutationRate: 0.8,
        mutationScale: 0.3,
        rng,
      }));
      continue;
    }

    // Tournament selection from elites
    const parent = elites[Math.floor(rng() * elites.length)];
    nextGen.push(mutateBotConfig(parent, {
      mutationRate,
      mutationScale,
      rng,
    }));
  }

  return nextGen;
}

/**
 * Evaluate a population of candidates.
 * Returns evaluation results ready for selection.
 *
 * @param {Object[]} population — array of bot configs
 * @param {function} runFn — async (config, seed) => { reward, runId, outcome }
 * @param {Object} params
 * @param {number[]} params.seeds — seeds to evaluate each candidate on
 * @param {function} [params.onCandidateComplete] — (candidateIndex, result)
 * @returns {Object[]} — [{ config, avgReward, bestReward, worstReward, runs, avgOutcome }]
 */
export async function evaluatePopulation(population, runFn, params) {
  const { seeds, onCandidateComplete } = params;
  const results = [];

  for (let i = 0; i < population.length; i++) {
    const config = population[i];
    const runs = [];
    let totalReward = 0;
    let bestReward = -Infinity;
    let worstReward = Infinity;

    // Accumulate outcome stats
    const outcomeAccum = {
      survivalTime: 0, kills: 0, level: 0, wave: 0, totalXP: 0, damageTaken: 0,
    };

    for (const seed of seeds) {
      const runResult = await runFn(config, seed);
      runs.push(runResult);
      const reward = runResult.reward || 0;
      totalReward += reward;
      if (reward > bestReward) bestReward = reward;
      if (reward < worstReward) worstReward = reward;

      if (runResult.outcome) {
        for (const key of Object.keys(outcomeAccum)) {
          outcomeAccum[key] += runResult.outcome[key] || 0;
        }
      }
    }

    const avgReward = totalReward / seeds.length;
    const avgOutcome = {};
    for (const key of Object.keys(outcomeAccum)) {
      avgOutcome[key] = round2(outcomeAccum[key] / seeds.length);
    }

    const result = { config, avgReward, bestReward, worstReward, runs, avgOutcome };
    results.push(result);

    if (onCandidateComplete) onCandidateComplete(i, result);
  }

  return results.sort((a, b) => b.avgReward - a.avgReward);
}

/**
 * Run one generation of evolutionary training.
 *
 * @param {Object} options
 * @param {string} options.experimentId
 * @param {number} options.generation
 * @param {Object[]} options.population — current generation's configs
 * @param {function} options.runFn — async (config, seed) => evaluation result
 * @param {number[]} options.seeds
 * @param {Object} options.trainingParams — from experiment config
 * @param {Object} [options.baseConfig] — for random injection
 * @param {function} [options.rng=Math.random]
 * @param {function} [options.onCandidateComplete]
 * @returns {Object} — { nextPopulation, generationArtifact, bestCandidate, evaluated }
 */
export async function runGeneration(options) {
  const {
    experimentId,
    generation,
    population,
    runFn,
    seeds,
    trainingParams,
    baseConfig,
    rng = Math.random,
    onCandidateComplete,
  } = options;

  // Evaluate all candidates
  const evaluated = await evaluatePopulation(population, runFn, {
    seeds,
    onCandidateComplete,
  });

  // Build generation artifact
  const generationArtifact = createGenerationArtifact({
    experimentId,
    generation,
    candidates: evaluated,
    populationStats: computePopulationStats(evaluated),
  });

  // Select and breed next generation
  const nextPopulation = selectAndMutate(evaluated, {
    populationSize: trainingParams.populationSize,
    eliteCount: trainingParams.eliteCount,
    mutationRate: trainingParams.mutationRate,
    mutationScale: trainingParams.mutationScale,
    randomInjectionRate: trainingParams.randomInjectionRate || 0.1,
    baseConfig,
    rng,
  });

  return {
    nextPopulation,
    generationArtifact,
    bestCandidate: evaluated[0],
    evaluated,
  };
}

/**
 * Compute population-level statistics for a generation.
 */
function computePopulationStats(evaluated) {
  if (evaluated.length === 0) return {};

  const rewards = evaluated.map(e => e.avgReward);
  const mean = rewards.reduce((a, b) => a + b, 0) / rewards.length;
  const variance = rewards.reduce((s, r) => s + (r - mean) ** 2, 0) / rewards.length;

  return {
    rewardMean: round2(mean),
    rewardStdDev: round2(Math.sqrt(variance)),
    rewardRange: round2(rewards[0] - rewards[rewards.length - 1]),
    diversity: computeParamDiversity(evaluated),
  };
}

/**
 * Compute parameter diversity across candidates.
 * Higher = more diverse population, lower = converging.
 */
function computeParamDiversity(evaluated) {
  if (evaluated.length < 2) return 0;

  const configs = evaluated.map(e => e.config);
  const keys = Object.keys(configs[0]?.weights || {}).filter(k => k !== 'upgradeWeights');

  let totalVariance = 0;
  let keyCount = 0;

  for (const key of keys) {
    const values = configs.map(c => c.weights?.[key] || 0);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    totalVariance += variance;
    keyCount++;
  }

  return keyCount > 0 ? round2(totalVariance / keyCount) : 0;
}

function round2(v) { return Math.round(v * 100) / 100; }
