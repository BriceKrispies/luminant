/**
 * Experiment configuration and artifact model.
 *
 * An experiment is a structured research run: a policy family,
 * reward/moment profile, seed strategy, training parameters,
 * and artifact output settings. Experiments produce generations
 * of candidates evaluated across seeds.
 *
 * Artifact types:
 * - 'run'         — single simulation result (existing)
 * - 'trajectory'  — observation/action/moment stream (new)
 * - 'generation'  — one generation's candidates + rankings
 * - 'experiment'  — full experiment config + generation history + best
 * - 'analytics'   — aggregate analysis across runs
 * - 'population'  — population snapshot (all candidate params)
 */

let _expCounter = 1;

/**
 * Generate a unique experiment ID.
 */
export function generateExperimentId() {
  return `exp-${Date.now()}-${_expCounter++}`;
}

/**
 * Create an experiment configuration.
 *
 * @param {Object} options
 * @param {string} [options.id]
 * @param {string} options.name — human-readable name
 * @param {string} [options.description]
 * @param {string} options.policyFamily — 'lab-bot'|'neural'|custom
 * @param {Object} options.basePolicyParams — starting policy params
 * @param {Object} [options.rewardWeights] — reward component weights
 * @param {Object} [options.momentWeights] — moment weight overrides
 * @param {string[]} [options.enabledMoments] — subset of moments to detect
 * @param {Object} training — training/evolution parameters
 * @param {number} [training.populationSize=10]
 * @param {number} [training.generations=10]
 * @param {number} [training.runsPerCandidate=3]
 * @param {number} [training.eliteCount=3]
 * @param {number} [training.mutationRate=0.3]
 * @param {number} [training.mutationScale=0.15]
 * @param {number} [training.maxTicks=18000]
 * @param {Object} [options.seedStrategy] — { type: 'sequential'|'fixed'|'random', seeds?, startSeed? }
 * @param {string} [options.trajectoryDetail='moments'] — detail level for trajectories
 * @param {Object} [options.artifactSettings] — output settings
 * @returns {ExperimentConfig}
 */
export function createExperimentConfig(options) {
  const {
    id = generateExperimentId(),
    name,
    description = '',
    policyFamily = 'lab-bot',
    basePolicyParams = {},
    rewardWeights = {},
    momentWeights = {},
    enabledMoments,
    training = {},
    seedStrategy = { type: 'sequential', startSeed: 1 },
    trajectoryDetail = 'moments',
    artifactSettings = {},
  } = options;

  return {
    type: 'experiment_config',
    version: 1,
    id,
    name,
    description,
    policyFamily,
    basePolicyParams,

    reward: {
      weights: rewardWeights,
      momentWeights,
      enabledMoments: enabledMoments || null, // null = all
      momentRewardScale: options.momentRewardScale || 1.0,
    },

    training: {
      populationSize: training.populationSize || 10,
      generations: training.generations || 10,
      runsPerCandidate: training.runsPerCandidate || 3,
      eliteCount: training.eliteCount || 3,
      mutationRate: training.mutationRate || 0.3,
      mutationScale: training.mutationScale || 0.15,
      maxTicks: training.maxTicks || 18000,
      randomInjectionRate: training.randomInjectionRate || 0.1,
    },

    seedStrategy,
    trajectoryDetail,

    artifacts: {
      saveTrajectories: artifactSettings.saveTrajectories !== false,
      saveGenerations: artifactSettings.saveGenerations !== false,
      savePopulations: artifactSettings.savePopulations !== false,
      saveBestOnly: artifactSettings.saveBestOnly || false,
      outputDir: artifactSettings.outputDir || 'artifacts',
    },

    meta: {
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * Validate an experiment config.
 * @param {Object} config
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateExperimentConfig(config) {
  const errors = [];

  if (!config.name) errors.push('name is required');
  if (!config.policyFamily) errors.push('policyFamily is required');
  if (!config.training) errors.push('training section is required');
  else {
    if (config.training.populationSize < 2) errors.push('populationSize must be >= 2');
    if (config.training.generations < 1) errors.push('generations must be >= 1');
    if (config.training.runsPerCandidate < 1) errors.push('runsPerCandidate must be >= 1');
    if (config.training.eliteCount >= config.training.populationSize) {
      errors.push('eliteCount must be < populationSize');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Create a generation artifact from evaluation results.
 *
 * @param {Object} options
 * @param {string} options.experimentId
 * @param {number} options.generation
 * @param {Object[]} options.candidates — [{ config, avgReward, runs }]
 * @param {Object} [options.populationStats]
 * @returns {Object} — generation artifact
 */
export function createGenerationArtifact(options) {
  const { experimentId, generation, candidates, populationStats = {} } = options;

  // Sort candidates by average reward
  const ranked = [...candidates].sort((a, b) => b.avgReward - a.avgReward);

  return {
    type: 'generation',
    version: 1,
    experimentId,
    generation,

    candidates: ranked.map((c, rank) => ({
      rank,
      name: c.config?.name || `candidate-${rank}`,
      avgReward: round2(c.avgReward),
      bestReward: round2(c.bestReward || c.avgReward),
      worstReward: round2(c.worstReward || c.avgReward),
      runCount: c.runs?.length || 0,
      runIds: (c.runs || []).map(r => r.runId || r),
      config: c.config,
      avgOutcome: c.avgOutcome || null,
    })),

    stats: {
      candidateCount: ranked.length,
      bestReward: ranked.length > 0 ? round2(ranked[0].avgReward) : 0,
      medianReward: ranked.length > 0
        ? round2(ranked[Math.floor(ranked.length / 2)].avgReward)
        : 0,
      worstReward: ranked.length > 0
        ? round2(ranked[ranked.length - 1].avgReward)
        : 0,
      ...populationStats,
    },

    meta: {
      recordedAt: new Date().toISOString(),
    },
  };
}

/**
 * Create an experiment summary artifact from completed experiment.
 *
 * @param {Object} options
 * @param {Object} options.config — experiment config
 * @param {Object[]} options.generationHistory — [generation artifacts]
 * @param {Object} options.bestCandidate — { config, avgReward }
 * @param {Object} [options.analytics]
 * @returns {Object} — experiment summary artifact
 */
export function createExperimentSummary(options) {
  const { config, generationHistory, bestCandidate, analytics = null } = options;

  const rewardCurve = generationHistory.map(g => ({
    generation: g.generation,
    best: g.stats.bestReward,
    median: g.stats.medianReward,
    worst: g.stats.worstReward,
  }));

  return {
    type: 'experiment',
    version: 1,
    experimentId: config.id,
    config,

    result: {
      bestCandidate: bestCandidate.config,
      bestReward: round2(bestCandidate.avgReward),
      generationCount: generationHistory.length,
      totalRuns: generationHistory.reduce(
        (sum, g) => sum + g.candidates.reduce((s, c) => s + c.runCount, 0), 0
      ),
    },

    rewardCurve,
    generationHistory: generationHistory.map(g => ({
      generation: g.generation,
      stats: g.stats,
      topCandidates: g.candidates.slice(0, 3).map(c => ({
        rank: c.rank,
        name: c.name,
        avgReward: c.avgReward,
      })),
    })),

    analytics,

    meta: {
      completedAt: new Date().toISOString(),
      startedAt: config.meta?.createdAt || null,
    },
  };
}

/**
 * Get seeds for a generation based on seed strategy.
 *
 * @param {Object} seedStrategy — from experiment config
 * @param {number} generation
 * @param {number} candidateIndex
 * @param {number} runIndex
 * @returns {number} — seed
 */
export function getSeed(seedStrategy, generation, candidateIndex, runIndex) {
  if (seedStrategy.type === 'fixed' && seedStrategy.seeds) {
    return seedStrategy.seeds[runIndex % seedStrategy.seeds.length];
  }
  const base = seedStrategy.startSeed || 1;
  if (seedStrategy.type === 'random') {
    // Deterministic "random" from generation/candidate/run
    return base + generation * 100000 + candidateIndex * 1000 + runIndex * 7 + 42;
  }
  // Sequential: same seeds for all candidates within a generation
  return base + generation * 1000 + runIndex;
}

function round2(v) { return Math.round(v * 100) / 100; }
