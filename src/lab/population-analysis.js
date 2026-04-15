/**
 * Population and lineage analysis for experiment architecture.
 *
 * Analyzes evolutionary runs to answer:
 * - Which parameters correlate with success?
 * - Which moments correlate with high reward?
 * - Are certain upgrade paths dominant?
 * - Is the population converging, diverging, or overfitting?
 * - Is a candidate dominant across seeds or seed-dependent?
 *
 * Operates on generation artifacts and run artifacts — pure analysis,
 * no simulation.
 */

/**
 * Analyze parameter-reward correlation across candidates.
 * Computes Pearson correlation between each weight key and average reward.
 *
 * @param {Object[]} candidates — [{ config, avgReward }]
 * @returns {Object[]} — [{ key, correlation, direction }] sorted by |correlation|
 */
export function analyzeParameterCorrelation(candidates) {
  if (candidates.length < 3) return [];

  const rewards = candidates.map(c => c.avgReward);
  const configs = candidates.map(c => c.config);

  // Collect all weight keys
  const keys = Object.keys(configs[0]?.weights || {}).filter(k => k !== 'upgradeWeights');

  const correlations = [];

  for (const key of keys) {
    const values = configs.map(c => c.weights?.[key] || 0);
    const r = pearsonCorrelation(values, rewards);
    if (!isNaN(r)) {
      correlations.push({
        key,
        correlation: round3(r),
        direction: r > 0 ? 'positive' : r < 0 ? 'negative' : 'neutral',
        mean: round3(mean(values)),
        stddev: round3(stddev(values)),
      });
    }
  }

  // Also check upgrade sub-weights
  const upgradeKeys = Object.keys(configs[0]?.weights?.upgradeWeights || {});
  for (const key of upgradeKeys) {
    const values = configs.map(c => c.weights?.upgradeWeights?.[key] || 0);
    const r = pearsonCorrelation(values, rewards);
    if (!isNaN(r)) {
      correlations.push({
        key: `upgrade.${key}`,
        correlation: round3(r),
        direction: r > 0 ? 'positive' : r < 0 ? 'negative' : 'neutral',
        mean: round3(mean(values)),
        stddev: round3(stddev(values)),
      });
    }
  }

  return correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
}

/**
 * Analyze moment frequency correlation with reward.
 * Which moments tend to occur more in high-reward runs?
 *
 * @param {Object[]} runs — [{ reward, moments }]
 *   where moments is [{ id, weight }] or a moment summary
 * @returns {Object[]} — [{ momentId, frequency, rewardCorrelation }]
 */
export function analyzeMomentCorrelation(runs) {
  if (runs.length < 3) return [];

  // Collect all moment IDs across runs
  const momentIds = new Set();
  for (const run of runs) {
    const moments = run.moments || [];
    for (const m of moments) {
      momentIds.add(m.id);
    }
  }

  const rewards = runs.map(r => r.reward || 0);
  const results = [];

  for (const id of momentIds) {
    const counts = runs.map(r => {
      const moments = r.moments || [];
      return moments.filter(m => m.id === id).length;
    });

    const r = pearsonCorrelation(counts, rewards);
    const totalCount = counts.reduce((a, b) => a + b, 0);

    results.push({
      momentId: id,
      totalOccurrences: totalCount,
      avgPerRun: round3(totalCount / runs.length),
      rewardCorrelation: isNaN(r) ? 0 : round3(r),
    });
  }

  return results.sort((a, b) => Math.abs(b.rewardCorrelation) - Math.abs(a.rewardCorrelation));
}

/**
 * Analyze upgrade path correlation with reward.
 *
 * @param {Object[]} runs — [{ reward, upgradePath }]
 * @returns {Object} — { bestPaths, upgradeRewardMap }
 */
export function analyzeUpgradeCorrelation(runs) {
  if (runs.length === 0) return { bestPaths: [], upgradeRewardMap: {} };

  // Map each upgrade to avg reward of runs that picked it
  const upgradeRewards = {};
  for (const run of runs) {
    const path = run.upgradePath || [];
    for (const upgrade of path) {
      if (!upgradeRewards[upgrade]) upgradeRewards[upgrade] = [];
      upgradeRewards[upgrade].push(run.reward || 0);
    }
  }

  const upgradeRewardMap = {};
  for (const [upgrade, rewards] of Object.entries(upgradeRewards)) {
    upgradeRewardMap[upgrade] = {
      pickCount: rewards.length,
      avgReward: round2(mean(rewards)),
      pickRate: round3(rewards.length / runs.length),
    };
  }

  // Best first-pick upgrades
  const firstPickRewards = {};
  for (const run of runs) {
    const path = run.upgradePath || [];
    if (path.length > 0) {
      const first = path[0];
      if (!firstPickRewards[first]) firstPickRewards[first] = [];
      firstPickRewards[first].push(run.reward || 0);
    }
  }

  const bestPaths = Object.entries(firstPickRewards)
    .map(([upgrade, rewards]) => ({
      upgrade,
      avgReward: round2(mean(rewards)),
      count: rewards.length,
    }))
    .sort((a, b) => b.avgReward - a.avgReward);

  return { bestPaths, upgradeRewardMap };
}

/**
 * Analyze candidate dominance across seeds.
 * A dominant candidate wins across many seeds, not just one.
 *
 * @param {Object[]} candidates — [{ config, runs: [{ seed, reward }] }]
 * @returns {Object[]} — [{ name, dominanceScore, seedWins, consistency }]
 */
export function analyzeCandidateDominance(candidates) {
  if (candidates.length < 2) return [];

  // For each seed, determine the winner
  const seedResults = {}; // seed → [{ candidateIdx, reward }]
  for (let i = 0; i < candidates.length; i++) {
    for (const run of candidates[i].runs || []) {
      const seed = run.seed || run.runId;
      if (!seedResults[seed]) seedResults[seed] = [];
      seedResults[seed].push({ candidateIdx: i, reward: run.reward || 0 });
    }
  }

  const seedWins = new Array(candidates.length).fill(0);
  const seedCount = Object.keys(seedResults).length;

  for (const results of Object.values(seedResults)) {
    results.sort((a, b) => b.reward - a.reward);
    if (results.length > 0) {
      seedWins[results[0].candidateIdx]++;
    }
  }

  return candidates.map((c, i) => {
    const rewards = (c.runs || []).map(r => r.reward || 0);
    return {
      name: c.config?.name || `candidate-${i}`,
      dominanceScore: seedCount > 0 ? round3(seedWins[i] / seedCount) : 0,
      seedWins: seedWins[i],
      totalSeeds: seedCount,
      consistency: rewards.length > 1 ? round3(1 - coefficientOfVariation(rewards)) : 0,
      avgReward: round2(c.avgReward || mean(rewards)),
    };
  }).sort((a, b) => b.dominanceScore - a.dominanceScore);
}

/**
 * Analyze convergence/stability across generations.
 * Detects improvement, stagnation, collapse, and overfit.
 *
 * @param {Object[]} generationArtifacts — from experiment
 * @returns {Object} — convergence analysis
 */
export function analyzeConvergence(generationArtifacts) {
  if (generationArtifacts.length < 2) {
    return { trend: 'insufficient_data', details: {} };
  }

  const bestRewards = generationArtifacts.map(g => g.stats?.bestReward || 0);
  const medianRewards = generationArtifacts.map(g => g.stats?.medianReward || 0);
  const diversities = generationArtifacts.map(g => g.stats?.diversity || 0);

  // Compute trends (simple linear regression slope)
  const bestSlope = linearSlope(bestRewards);
  const medianSlope = linearSlope(medianRewards);
  const diversitySlope = linearSlope(diversities);

  // Detect patterns
  let trend;
  if (bestSlope > 0.5 && medianSlope > 0.3) {
    trend = 'improving';
  } else if (Math.abs(bestSlope) < 0.2 && Math.abs(medianSlope) < 0.2) {
    trend = 'stagnating';
  } else if (bestSlope > 0.3 && medianSlope < -0.2) {
    trend = 'overfitting'; // best improves but median drops
  } else if (bestSlope < -0.3) {
    trend = 'collapsing';
  } else {
    trend = 'mixed';
  }

  // Check for diversity collapse
  const diversityCollapse = diversities.length > 2 &&
    diversities[diversities.length - 1] < diversities[0] * 0.1;

  return {
    trend,
    bestSlope: round3(bestSlope),
    medianSlope: round3(medianSlope),
    diversitySlope: round3(diversitySlope),
    diversityCollapse,
    bestRewards: bestRewards.map(round2),
    medianRewards: medianRewards.map(round2),
    diversities: diversities.map(round3),
  };
}

/**
 * Full population analysis report.
 *
 * @param {Object} options
 * @param {Object[]} options.generations — generation artifacts
 * @param {Object[]} options.allRuns — all run results [{ reward, moments, upgradePath, config }]
 * @returns {Object}
 */
export function fullPopulationAnalysis(options) {
  const { generations = [], allRuns = [] } = options;

  // Collect all candidates from latest generation
  const latestGen = generations[generations.length - 1];
  const latestCandidates = latestGen?.candidates || [];

  return {
    parameterCorrelation: analyzeParameterCorrelation(
      latestCandidates.map(c => ({ config: c.config, avgReward: c.avgReward }))
    ),
    momentCorrelation: analyzeMomentCorrelation(allRuns),
    upgradeCorrelation: analyzeUpgradeCorrelation(allRuns),
    convergence: analyzeConvergence(generations),
    generationCount: generations.length,
    totalRuns: allRuns.length,
  };
}

// ── Statistics helpers ──

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function coefficientOfVariation(arr) {
  const m = mean(arr);
  if (m === 0) return 0;
  return stddev(arr) / Math.abs(m);
}

function pearsonCorrelation(x, y) {
  const n = x.length;
  if (n < 3) return NaN;

  const mx = mean(x);
  const my = mean(y);

  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }

  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return 0;
  return num / denom;
}

function linearSlope(arr) {
  if (arr.length < 2) return 0;
  const n = arr.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += arr[i];
    sumXY += i * arr[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function round2(v) { return Math.round(v * 100) / 100; }
function round3(v) { return Math.round(v * 1000) / 1000; }
