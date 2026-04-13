/**
 * Evolutionary parameter search.
 * Generates policy parameter variants, evaluates them via batch simulation,
 * keeps top performers, mutates, and repeats.
 *
 * Does not require external ML libraries — pure JS.
 */

import { runGame } from './game-runner.js';
import { computeScore, aggregateResults } from './scoring.js';

/**
 * @typedef {Object} EvolveConfig
 * @property {string} policyId — which policy to evolve
 * @property {function(Object): PolicyInterface} policyFactory — creates policy from params
 * @property {Object} baseParams — starting parameter set
 * @property {Object} paramRanges — { key: [min, max] } for each tunable param
 * @property {number} populationSize — individuals per generation (default: 10)
 * @property {number} generations — number of generations (default: 5)
 * @property {number} runsPerIndividual — games per parameter set (default: 3)
 * @property {number} eliteCount — top N to keep (default: 3)
 * @property {number} mutationRate — fraction of params to mutate (default: 0.3)
 * @property {number} mutationScale — mutation magnitude as fraction of range (default: 0.15)
 * @property {number} maxTicks — max ticks per game
 * @property {number} seed — base seed
 * @property {Object} wasm — pre-loaded WASM exports
 * @property {function} onGeneration — callback(gen, results)
 */

/**
 * Run evolutionary search over policy parameters.
 *
 * @param {EvolveConfig} config
 * @returns {Object} — { bestParams, bestScore, history }
 */
export async function evolve(config) {
  const {
    policyFactory,
    baseParams,
    paramRanges,
    populationSize = 10,
    generations = 5,
    runsPerIndividual = 3,
    eliteCount = 3,
    mutationRate = 0.3,
    mutationScale = 0.15,
    maxTicks = 18000,
    seed = 42,
    wasm,
    onGeneration,
  } = config;

  const tunableKeys = Object.keys(paramRanges);

  // Initialize population
  let population = [];
  population.push({ ...baseParams }); // always include base
  for (let i = 1; i < populationSize; i++) {
    population.push(mutateParams(baseParams, tunableKeys, paramRanges, 0.5, mutationScale * 2));
  }

  const history = [];
  let allTimeBest = { params: baseParams, score: -Infinity };

  for (let gen = 0; gen < generations; gen++) {
    const genResults = [];

    for (let i = 0; i < population.length; i++) {
      const params = population[i];
      const runResults = [];

      for (let r = 0; r < runsPerIndividual; r++) {
        const policy = policyFactory(params);
        const result = await runGame({
          policy,
          seed: seed + gen * 1000 + i * 100 + r,
          maxTicks,
          wasm,
          silent: true,
        });
        runResults.push(result);
      }

      const avgScore = runResults.reduce((s, r) => s + r.score, 0) / runResults.length;

      genResults.push({
        params: { ...params },
        avgScore,
        runs: runResults,
      });
    }

    // Sort by score
    genResults.sort((a, b) => b.avgScore - a.avgScore);

    // Track all-time best
    if (genResults[0].avgScore > allTimeBest.score) {
      allTimeBest = {
        params: { ...genResults[0].params },
        score: genResults[0].avgScore,
      };
    }

    history.push({
      generation: gen,
      best: genResults[0].avgScore,
      median: genResults[Math.floor(genResults.length / 2)].avgScore,
      worst: genResults[genResults.length - 1].avgScore,
      bestParams: { ...genResults[0].params },
    });

    if (onGeneration) {
      onGeneration(gen, genResults);
    }

    // Selection: keep elites
    const elites = genResults.slice(0, eliteCount).map(r => r.params);

    // Build next generation
    population = [];
    // Keep elites unchanged
    for (const elite of elites) {
      population.push({ ...elite });
    }
    // Fill rest with mutated elites
    while (population.length < populationSize) {
      const parent = elites[Math.floor(Math.random() * elites.length)];
      population.push(mutateParams(parent, tunableKeys, paramRanges, mutationRate, mutationScale));
    }
  }

  return {
    bestParams: allTimeBest.params,
    bestScore: allTimeBest.score,
    history,
  };
}

/**
 * Mutate a parameter set.
 */
function mutateParams(params, keys, ranges, rate, scale) {
  const result = { ...params };

  for (const key of keys) {
    if (Math.random() > rate) continue;

    const [min, max] = ranges[key];
    const range = max - min;
    const delta = (Math.random() * 2 - 1) * range * scale;
    let val = (result[key] || 0) + delta;
    val = Math.max(min, Math.min(max, val));

    // Round to reasonable precision
    result[key] = Math.round(val * 1000) / 1000;
  }

  return result;
}
