/**
 * Experiment runner / orchestrator.
 *
 * Wires experiment config → training backend → game runner → artifact persistence.
 * This is the top-level entry point for running a structured experiment.
 *
 * Responsibilities:
 * - Initialize population from experiment config
 * - Run generations through the training backend
 * - Wire featurizer + moment detector + trajectory recorder per run
 * - Collect and emit artifacts (generations, trajectories, experiment summary)
 * - Report progress via callbacks
 */

import { runGame } from '../ai/game-runner.js';
import { createBotPolicy, createBotConfig, serializeBotConfig } from './bot.js';
import { computeRewardBreakdown } from './rewards.js';
import { createRunRecorder, generateRunId } from './run-recorder.js';
import { createFeaturizer } from './featurizer.js';
import { createMomentDetector, computeMomentReward, summarizeMoments } from './moments.js';
import { createTrajectoryRecorder } from './trajectory.js';
import {
  createExperimentConfig,
  createExperimentSummary,
  getSeed,
  validateExperimentConfig,
} from './experiment.js';
import { initializePopulation, runGeneration } from './training.js';
import { createLineageTree } from './lineage.js';

/**
 * Run a full experiment from config to completion.
 *
 * @param {Object} experimentConfig — from createExperimentConfig
 * @param {Object} [options]
 * @param {Object} [options.wasm] — pre-loaded WASM
 * @param {function} [options.onGeneration] — (gen, artifact) callback
 * @param {function} [options.onRun] — (gen, candidateIdx, runIdx, result) callback
 * @param {function} [options.onProgress] — (message) callback
 * @param {function} [options.rng=Math.random]
 * @returns {Object} — { experimentSummary, generations, artifacts, lineage }
 */
export async function runExperiment(experimentConfig, options = {}) {
  const {
    wasm,
    onGeneration,
    onRun,
    onProgress,
    rng = Math.random,
  } = options;

  // Validate config
  const validation = validateExperimentConfig(experimentConfig);
  if (!validation.valid) {
    throw new Error(`Invalid experiment config: ${validation.errors.join(', ')}`);
  }

  const config = experimentConfig;
  const training = config.training;
  const featurizer = createFeaturizer();

  const allArtifacts = [];
  const generationHistory = [];
  const lineage = createLineageTree();

  let allTimeBest = null;
  let allTimeBestReward = -Infinity;

  if (onProgress) onProgress(`Starting experiment "${config.name}" — ${training.generations} generations, pop ${training.populationSize}`);

  // Initialize population
  const baseConfig = createBotConfig({
    name: config.name + '-base',
    ...config.basePolicyParams,
  });

  let population = initializePopulation(baseConfig, training.populationSize, {
    mutationRate: 0.5,
    mutationScale: 0.2,
    rng,
  });

  // Run generations
  for (let gen = 0; gen < training.generations; gen++) {
    if (onProgress) onProgress(`Generation ${gen + 1}/${training.generations}`);

    // Build seeds for this generation
    const seeds = [];
    for (let r = 0; r < training.runsPerCandidate; r++) {
      seeds.push(getSeed(config.seedStrategy, gen, 0, r));
    }

    // Create the run function that wires everything together
    const runFn = async (candidateConfig, seed) => {
      return runSingleEvaluation({
        candidateConfig,
        seed,
        maxTicks: training.maxTicks,
        wasm,
        featurizer,
        experimentConfig: config,
        generation: gen,
        lineage,
        allArtifacts,
      });
    };

    // Run this generation
    const genResult = await runGeneration({
      experimentId: config.id,
      generation: gen,
      population,
      runFn,
      seeds,
      trainingParams: training,
      baseConfig,
      rng,
      onCandidateComplete: (idx, result) => {
        if (onRun) onRun(gen, idx, result.runs.length, result);
      },
    });

    generationHistory.push(genResult.generationArtifact);
    population = genResult.nextPopulation;

    if (genResult.bestCandidate.avgReward > allTimeBestReward) {
      allTimeBestReward = genResult.bestCandidate.avgReward;
      allTimeBest = genResult.bestCandidate;
    }

    if (onGeneration) onGeneration(gen, genResult.generationArtifact);
  }

  // Build experiment summary
  const experimentSummary = createExperimentSummary({
    config,
    generationHistory,
    bestCandidate: allTimeBest || { config: baseConfig, avgReward: 0 },
  });

  if (onProgress) onProgress(`Experiment complete. Best reward: ${round2(allTimeBestReward)}`);

  return {
    experimentSummary,
    generations: generationHistory,
    artifacts: allArtifacts,
    lineage,
    bestConfig: allTimeBest?.config || baseConfig,
    bestReward: allTimeBestReward,
  };
}

/**
 * Run a single candidate evaluation (one config + one seed).
 * Wires featurizer, moments, trajectory, recorder, and game-runner.
 */
async function runSingleEvaluation(params) {
  const {
    candidateConfig,
    seed,
    maxTicks,
    wasm,
    featurizer,
    experimentConfig,
    generation,
    lineage,
    allArtifacts,
  } = params;

  const policy = createBotPolicy(candidateConfig);
  const runId = generateRunId();

  // Set up moment detector
  const momentDetector = createMomentDetector({
    enabledMoments: experimentConfig.reward?.enabledMoments || undefined,
    weightOverrides: experimentConfig.reward?.momentWeights || {},
  });

  // Set up trajectory recorder
  const trajectoryRecorder = createTrajectoryRecorder({
    runId,
    detailLevel: experimentConfig.trajectoryDetail || 'moments',
    featureSchema: featurizer.getSchema(),
    policyId: candidateConfig.name,
    policyParams: serializeBotConfig(candidateConfig),
    generation,
    seed,
  });

  // Set up run recorder (existing lab recorder)
  const recorder = createRunRecorder({
    runId,
    generation,
    seed,
    botConfig: serializeBotConfig(candidateConfig),
  });

  // Run the game
  const result = await runGame({
    policy,
    seed,
    maxTicks,
    wasm,
    recordSnapshots: true,
    snapshotInterval: 300,
    silent: true,
  });

  // Process upgrade history
  for (const entry of result.upgradeHistory || []) {
    recorder.recordUpgrade(entry);
    trajectoryRecorder.recordUpgrade(entry);
  }

  // Compute reward
  const rewardBreakdown = computeRewardBreakdown(result, experimentConfig.reward?.weights);
  const momentRewardScale = experimentConfig.reward?.momentRewardScale || 1.0;

  // Compute moment reward from any moments recorded during the trajectory
  const allMoments = [];
  // Since we can't hook into per-tick observation in the existing game-runner,
  // we compute a post-hoc moment reward estimate from the run result
  const momentReward = computeMomentReward(allMoments) * momentRewardScale;

  const totalReward = (rewardBreakdown.total || 0) + momentReward;

  // Finalize artifacts
  const artifact = recorder.finalize(result, rewardBreakdown);
  const trajectory = trajectoryRecorder.finalize(result);

  // Add to lineage
  lineage.addRun({
    runId,
    parentRunId: null,
    generation,
    botConfig: serializeBotConfig(candidateConfig),
    summary: artifact.summary,
    reward: rewardBreakdown,
  });

  allArtifacts.push(artifact);

  return {
    runId,
    reward: totalReward,
    rewardBreakdown,
    outcome: artifact.summary,
    trajectory,
    artifact,
  };
}

/**
 * Run a quick single-config evaluation (no evolution).
 * Useful for testing a specific config across seeds.
 *
 * @param {Object} options
 * @param {Object} options.botConfig
 * @param {number[]} options.seeds
 * @param {number} [options.maxTicks=18000]
 * @param {Object} [options.wasm]
 * @param {Object} [options.rewardWeights]
 * @returns {Object} — { avgReward, results }
 */
export async function evaluateConfig(options) {
  const { botConfig, seeds, maxTicks = 18000, wasm, rewardWeights } = options;

  const results = [];
  let totalReward = 0;

  for (const seed of seeds) {
    const policy = createBotPolicy(botConfig);
    const result = await runGame({
      policy, seed, maxTicks, wasm,
      recordSnapshots: true, snapshotInterval: 300, silent: true,
    });
    const reward = computeRewardBreakdown(result, rewardWeights);
    results.push({ seed, result, reward });
    totalReward += reward.total;
  }

  return {
    avgReward: round2(totalReward / seeds.length),
    results,
  };
}

function round2(v) { return Math.round(v * 100) / 100; }
