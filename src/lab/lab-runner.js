/**
 * Lab-aware game runner.
 * Wraps the existing game-runner with recording, reward computation,
 * and lineage tracking. Does NOT replace the original runner — sits on top.
 *
 * Used by the harness/simulation-lab.js CLI and the debug UI.
 */

import { runGame } from '../ai/game-runner.js';
import { createBotPolicy, createBotConfig, mutateBotConfig, serializeBotConfig } from './bot.js';
import { computeRewardBreakdown } from './rewards.js';
import { createRunRecorder, generateRunId } from './run-recorder.js';
import { createLineageTree } from './lineage.js';
import { analyzeUpgrades, formatAnalyticsSummary } from './analytics.js';

/**
 * Run a single lab simulation.
 *
 * @param {Object} options
 * @param {Object} options.botConfig — from createBotConfig
 * @param {number} [options.seed]
 * @param {number} [options.maxTicks=30000]
 * @param {string|null} [options.parentRunId]
 * @param {number} [options.generation=0]
 * @param {number} [options.snapshotInterval=300]
 * @param {Object} [options.wasm] — pre-loaded WASM
 * @param {Object} [options.rewardWeights] — override reward weights
 * @param {boolean} [options.silent=true]
 * @returns {Object} — { result, artifact }
 */
export async function runLabSim(options) {
  const {
    botConfig,
    seed = Date.now(),
    maxTicks = 30000,
    parentRunId = null,
    generation = 0,
    snapshotInterval = 300,
    wasm,
    rewardWeights,
    silent = true,
  } = options;

  const policy = createBotPolicy(botConfig);
  const runId = generateRunId();

  const recorder = createRunRecorder({
    runId,
    parentRunId,
    generation,
    seed,
    botConfig: serializeBotConfig(botConfig),
    snapshotInterval,
  });

  // Run the game through the standard runner
  const result = await runGame({
    policy,
    seed,
    maxTicks,
    wasm,
    recordSnapshots: true,
    snapshotInterval,
    silent,
  });

  // Feed upgrade history to recorder
  for (const entry of result.upgradeHistory || []) {
    recorder.recordUpgrade(entry);
  }

  // Compute structured reward
  const rewardBreakdown = computeRewardBreakdown(result, rewardWeights);

  // Finalize artifact
  const artifact = recorder.finalize(result, rewardBreakdown);

  return { result, artifact };
}

/**
 * Run a batch of lab simulations.
 *
 * @param {Object} options
 * @param {number} [options.runs=10]
 * @param {Object} options.botConfig — starting bot config
 * @param {number} [options.startSeed]
 * @param {number} [options.maxTicks=30000]
 * @param {boolean} [options.mutate=false] — mutate between runs
 * @param {number} [options.snapshotInterval=300]
 * @param {Object} [options.wasm]
 * @param {Object} [options.rewardWeights]
 * @param {boolean} [options.silent=true]
 * @param {function} [options.onRun] — callback(runIndex, artifact)
 * @returns {Object} — { artifacts, analytics, lineage, summary }
 */
export async function runLabBatch(options) {
  const {
    runs = 10,
    botConfig: baseBotConfig,
    startSeed = Date.now(),
    maxTicks = 30000,
    mutate = false,
    snapshotInterval = 300,
    wasm,
    rewardWeights,
    silent = true,
    onRun,
  } = options;

  const artifacts = [];
  const lineage = createLineageTree();
  let currentConfig = baseBotConfig;
  let parentRunId = null;
  let generation = 0;

  for (let i = 0; i < runs; i++) {
    const seed = startSeed + i;

    // Mutate config for evolutionary runs
    if (mutate && i > 0) {
      currentConfig = mutateBotConfig(currentConfig, {
        mutationRate: 0.3,
        mutationScale: 0.15,
      });
      generation = Math.floor(i / Math.max(1, Math.floor(runs / 5)));
    }

    const { artifact } = await runLabSim({
      botConfig: currentConfig,
      seed,
      maxTicks,
      parentRunId,
      generation,
      snapshotInterval,
      wasm,
      rewardWeights,
      silent,
    });

    artifacts.push(artifact);

    lineage.addRun({
      runId: artifact.runId,
      parentRunId: artifact.parentRunId,
      generation: artifact.generation,
      botConfig: artifact.botConfig,
      summary: artifact.summary,
      reward: artifact.reward,
    });

    if (mutate) {
      parentRunId = artifact.runId;
    }

    if (onRun) onRun(i, artifact);
  }

  const analytics = analyzeUpgrades(artifacts);

  // Compute batch summary
  const rewards = artifacts.map(a => a.reward?.total ?? 0);
  const scores = artifacts.map(a => a.summary?.score ?? 0);
  const times = artifacts.map(a => a.summary?.survivalTime ?? 0);

  const summary = {
    runs: artifacts.length,
    avgReward: mean(rewards),
    bestReward: Math.max(...rewards),
    avgScore: mean(scores),
    bestScore: Math.max(...scores),
    avgSurvivalTime: mean(times),
    survivalRate: artifacts.filter(a => a.summary?.survived).length / artifacts.length,
  };

  return { artifacts, analytics, lineage, summary };
}

/**
 * Run an evolutionary batch where each generation selects the best
 * configs and mutates them for the next generation.
 *
 * @param {Object} options
 * @param {Object} options.botConfig — starting config
 * @param {number} [options.populationSize=8]
 * @param {number} [options.generations=5]
 * @param {number} [options.runsPerConfig=2]
 * @param {number} [options.eliteCount=3]
 * @param {number} [options.startSeed]
 * @param {number} [options.maxTicks=18000]
 * @param {Object} [options.wasm]
 * @param {Object} [options.rewardWeights]
 * @param {boolean} [options.silent=true]
 * @param {function} [options.onGeneration] — callback(gen, bestArtifact)
 * @returns {Object} — { bestConfig, artifacts, analytics, lineage, history }
 */
export async function runLabEvolution(options) {
  const {
    botConfig: baseConfig,
    populationSize = 8,
    generations = 5,
    runsPerConfig = 2,
    eliteCount = 3,
    startSeed = Date.now(),
    maxTicks = 18000,
    wasm,
    rewardWeights,
    silent = true,
    onGeneration,
  } = options;

  const allArtifacts = [];
  const lineage = createLineageTree();
  const history = [];

  // Initialize population
  let population = [baseConfig];
  for (let i = 1; i < populationSize; i++) {
    population.push(mutateBotConfig(baseConfig, { mutationRate: 0.5, mutationScale: 0.2 }));
  }

  let allTimeBest = null;
  let allTimeBestReward = -Infinity;

  for (let gen = 0; gen < generations; gen++) {
    const genResults = [];

    for (let i = 0; i < population.length; i++) {
      const config = population[i];
      let totalReward = 0;
      let bestArtifact = null;

      for (let r = 0; r < runsPerConfig; r++) {
        const seed = startSeed + gen * 10000 + i * 100 + r;
        const parentRunId = gen > 0 ? `gen${gen - 1}-elite` : null;

        const { artifact } = await runLabSim({
          botConfig: config,
          seed,
          maxTicks,
          parentRunId,
          generation: gen,
          wasm,
          rewardWeights,
          silent,
        });

        allArtifacts.push(artifact);
        lineage.addRun({
          runId: artifact.runId,
          parentRunId: artifact.parentRunId,
          generation: gen,
          botConfig: artifact.botConfig,
          summary: artifact.summary,
          reward: artifact.reward,
        });

        totalReward += artifact.reward?.total ?? 0;
        if (!bestArtifact || (artifact.reward?.total ?? 0) > (bestArtifact.reward?.total ?? 0)) {
          bestArtifact = artifact;
        }
      }

      genResults.push({
        config,
        avgReward: totalReward / runsPerConfig,
        bestArtifact,
      });
    }

    // Sort by average reward
    genResults.sort((a, b) => b.avgReward - a.avgReward);

    if (genResults[0].avgReward > allTimeBestReward) {
      allTimeBestReward = genResults[0].avgReward;
      allTimeBest = genResults[0].config;
    }

    history.push({
      generation: gen,
      bestReward: genResults[0].avgReward,
      medianReward: genResults[Math.floor(genResults.length / 2)].avgReward,
      worstReward: genResults[genResults.length - 1].avgReward,
    });

    if (onGeneration) onGeneration(gen, genResults[0].bestArtifact);

    // Select elites and mutate
    const elites = genResults.slice(0, eliteCount).map(r => r.config);
    population = [...elites];
    while (population.length < populationSize) {
      const parent = elites[Math.floor(Math.random() * elites.length)];
      population.push(mutateBotConfig(parent));
    }
  }

  const analytics = analyzeUpgrades(allArtifacts);

  return {
    bestConfig: allTimeBest,
    bestReward: allTimeBestReward,
    artifacts: allArtifacts,
    analytics,
    lineage,
    history,
  };
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
