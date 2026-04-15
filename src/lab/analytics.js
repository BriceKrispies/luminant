/**
 * Upgrade analytics for simulation lab.
 * Aggregates across many run artifacts to answer:
 * - Which upgrades have highest average reward contribution
 * - Strongest first pick
 * - Strongest upgrade pairings
 * - Strongest upgrades by wave reached
 * - Strongest by policy archetype
 * - Pick rate vs success rate
 * - Dead picks (frequently chosen, rarely succeed)
 *
 * Produces both machine-readable JSON and human-readable summaries.
 */

/**
 * Run full analytics across an array of run artifacts.
 *
 * @param {Object[]} artifacts — run artifacts from run-recorder
 * @returns {Object} — full analytics report
 */
export function analyzeUpgrades(artifacts) {
  if (artifacts.length === 0) return emptyReport();

  return {
    sampleSize: artifacts.length,
    bestUpgradesByReward: analyzeByReward(artifacts),
    strongestFirstPick: analyzeFirstPick(artifacts),
    strongestPairings: analyzePairings(artifacts),
    byWaveReached: analyzeByWave(artifacts),
    byPolicyArchetype: analyzeByPolicy(artifacts),
    pickRateVsSuccess: analyzePickRate(artifacts),
    deadPicks: analyzeDeadPicks(artifacts),
  };
}

/**
 * Which upgrades correlate with highest total reward.
 */
function analyzeByReward(artifacts) {
  const upgradeRewards = {};

  for (const art of artifacts) {
    const upgrades = art.summary?.upgradePath || [];
    const reward = art.reward?.total ?? art.summary?.score ?? 0;

    for (const id of new Set(upgrades)) {
      if (!upgradeRewards[id]) upgradeRewards[id] = { rewards: [], count: 0 };
      upgradeRewards[id].rewards.push(reward);
      upgradeRewards[id].count++;
    }
  }

  return Object.entries(upgradeRewards)
    .map(([id, data]) => ({
      upgrade: id,
      count: data.count,
      avgReward: mean(data.rewards),
      maxReward: Math.max(...data.rewards),
      minReward: Math.min(...data.rewards),
    }))
    .sort((a, b) => b.avgReward - a.avgReward);
}

/**
 * Best first upgrade pick by average outcome.
 */
function analyzeFirstPick(artifacts) {
  const firstPicks = {};

  for (const art of artifacts) {
    const path = art.summary?.upgradePath || [];
    if (path.length === 0) continue;
    const first = path[0];
    const reward = art.reward?.total ?? art.summary?.score ?? 0;

    if (!firstPicks[first]) firstPicks[first] = { rewards: [], count: 0 };
    firstPicks[first].rewards.push(reward);
    firstPicks[first].count++;
  }

  return Object.entries(firstPicks)
    .map(([id, data]) => ({
      upgrade: id,
      count: data.count,
      avgReward: mean(data.rewards),
      pickRate: data.count / artifacts.length,
    }))
    .sort((a, b) => b.avgReward - a.avgReward);
}

/**
 * Which pairs of upgrades yield the best outcomes.
 */
function analyzePairings(artifacts) {
  const pairScores = {};

  for (const art of artifacts) {
    const upgrades = [...new Set(art.summary?.upgradePath || [])];
    const reward = art.reward?.total ?? art.summary?.score ?? 0;

    for (let i = 0; i < upgrades.length; i++) {
      for (let j = i + 1; j < upgrades.length; j++) {
        const pair = [upgrades[i], upgrades[j]].sort().join('+');
        if (!pairScores[pair]) pairScores[pair] = { rewards: [], count: 0 };
        pairScores[pair].rewards.push(reward);
        pairScores[pair].count++;
      }
    }
  }

  return Object.entries(pairScores)
    .filter(([, data]) => data.count >= 2)
    .map(([pair, data]) => ({
      pair,
      count: data.count,
      avgReward: mean(data.rewards),
    }))
    .sort((a, b) => b.avgReward - a.avgReward)
    .slice(0, 20);
}

/**
 * Which upgrades correlate with reaching higher waves.
 */
function analyzeByWave(artifacts) {
  const upgradeWaves = {};

  for (const art of artifacts) {
    const upgrades = art.summary?.upgradePath || [];
    const wave = art.summary?.wave ?? 0;

    for (const id of new Set(upgrades)) {
      if (!upgradeWaves[id]) upgradeWaves[id] = { waves: [], count: 0 };
      upgradeWaves[id].waves.push(wave);
      upgradeWaves[id].count++;
    }
  }

  return Object.entries(upgradeWaves)
    .map(([id, data]) => ({
      upgrade: id,
      count: data.count,
      avgWave: mean(data.waves),
      maxWave: Math.max(...data.waves),
    }))
    .sort((a, b) => b.avgWave - a.avgWave);
}

/**
 * Upgrade performance segmented by policy bias pattern.
 */
function analyzeByPolicy(artifacts) {
  const policyGroups = {};

  for (const art of artifacts) {
    const biases = art.botConfig?.biases || [];
    const key = biases.length > 0 ? biases.sort().join('+') : 'default';
    const upgrades = art.summary?.upgradePath || [];
    const reward = art.reward?.total ?? art.summary?.score ?? 0;

    if (!policyGroups[key]) policyGroups[key] = { upgradeRewards: {}, count: 0 };
    policyGroups[key].count++;

    for (const id of new Set(upgrades)) {
      if (!policyGroups[key].upgradeRewards[id]) {
        policyGroups[key].upgradeRewards[id] = [];
      }
      policyGroups[key].upgradeRewards[id].push(reward);
    }
  }

  const result = {};
  for (const [policy, data] of Object.entries(policyGroups)) {
    result[policy] = {
      runCount: data.count,
      topUpgrades: Object.entries(data.upgradeRewards)
        .map(([id, rewards]) => ({
          upgrade: id,
          count: rewards.length,
          avgReward: mean(rewards),
        }))
        .sort((a, b) => b.avgReward - a.avgReward)
        .slice(0, 10),
    };
  }
  return result;
}

/**
 * Pick rate vs success rate for each upgrade.
 * Success = run reached top quartile of total rewards.
 */
function analyzePickRate(artifacts) {
  if (artifacts.length < 4) return [];

  const allRewards = artifacts.map(a => a.reward?.total ?? a.summary?.score ?? 0);
  const sorted = [...allRewards].sort((a, b) => a - b);
  const successThreshold = sorted[Math.floor(sorted.length * 0.75)];

  const stats = {};

  for (const art of artifacts) {
    const upgrades = new Set(art.summary?.upgradePath || []);
    const reward = art.reward?.total ?? art.summary?.score ?? 0;
    const isSuccess = reward >= successThreshold;

    for (const id of upgrades) {
      if (!stats[id]) stats[id] = { picked: 0, successful: 0 };
      stats[id].picked++;
      if (isSuccess) stats[id].successful++;
    }
  }

  return Object.entries(stats)
    .map(([id, data]) => ({
      upgrade: id,
      pickRate: data.picked / artifacts.length,
      successRate: data.picked > 0 ? data.successful / data.picked : 0,
      pickCount: data.picked,
      successCount: data.successful,
    }))
    .sort((a, b) => b.successRate - a.successRate);
}

/**
 * Dead picks: frequently chosen but correlated with poor outcomes.
 */
function analyzeDeadPicks(artifacts) {
  if (artifacts.length < 4) return [];

  const allRewards = artifacts.map(a => a.reward?.total ?? a.summary?.score ?? 0);
  const overallMean = mean(allRewards);

  const stats = {};

  for (const art of artifacts) {
    const upgrades = new Set(art.summary?.upgradePath || []);
    const reward = art.reward?.total ?? art.summary?.score ?? 0;

    for (const id of upgrades) {
      if (!stats[id]) stats[id] = { rewards: [], count: 0 };
      stats[id].rewards.push(reward);
      stats[id].count++;
    }
  }

  const minPicks = Math.max(2, Math.floor(artifacts.length * 0.1));

  return Object.entries(stats)
    .filter(([, data]) => data.count >= minPicks)
    .map(([id, data]) => ({
      upgrade: id,
      pickCount: data.count,
      pickRate: data.count / artifacts.length,
      avgReward: mean(data.rewards),
      rewardDelta: mean(data.rewards) - overallMean,
    }))
    .filter(entry => entry.rewardDelta < 0)
    .sort((a, b) => a.rewardDelta - b.rewardDelta);
}

/**
 * Generate a human-readable text summary of analytics.
 */
export function formatAnalyticsSummary(report) {
  const lines = [];
  lines.push('=== UPGRADE ANALYTICS ===');
  lines.push(`Sample size: ${report.sampleSize} runs\n`);

  // Best upgrades
  lines.push('--- Best Upgrades by Reward ---');
  for (const entry of (report.bestUpgradesByReward || []).slice(0, 5)) {
    lines.push(`  ${entry.upgrade}: avg=${entry.avgReward.toFixed(1)} (${entry.count}x)`);
  }

  // Strongest first pick
  lines.push('\n--- Strongest First Pick ---');
  for (const entry of (report.strongestFirstPick || []).slice(0, 5)) {
    lines.push(`  ${entry.upgrade}: avg=${entry.avgReward.toFixed(1)} (${(entry.pickRate * 100).toFixed(0)}% pick rate)`);
  }

  // Best pairings
  lines.push('\n--- Strongest Pairings ---');
  for (const entry of (report.strongestPairings || []).slice(0, 5)) {
    lines.push(`  ${entry.pair}: avg=${entry.avgReward.toFixed(1)} (${entry.count}x)`);
  }

  // By wave
  lines.push('\n--- Best Upgrades by Wave Reached ---');
  for (const entry of (report.byWaveReached || []).slice(0, 5)) {
    lines.push(`  ${entry.upgrade}: avg wave=${entry.avgWave.toFixed(1)}, max=${entry.maxWave}`);
  }

  // Dead picks
  lines.push('\n--- Dead Picks (high pick rate, low reward) ---');
  for (const entry of (report.deadPicks || []).slice(0, 5)) {
    lines.push(`  ${entry.upgrade}: ${(entry.pickRate * 100).toFixed(0)}% pick rate, reward delta=${entry.rewardDelta.toFixed(1)}`);
  }

  // Pick rate vs success
  lines.push('\n--- Pick Rate vs Success Rate ---');
  for (const entry of (report.pickRateVsSuccess || []).slice(0, 8)) {
    lines.push(`  ${entry.upgrade}: pick=${(entry.pickRate * 100).toFixed(0)}%, success=${(entry.successRate * 100).toFixed(0)}%`);
  }

  return lines.join('\n');
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function emptyReport() {
  return {
    sampleSize: 0,
    bestUpgradesByReward: [],
    strongestFirstPick: [],
    strongestPairings: [],
    byWaveReached: [],
    byPolicyArchetype: {},
    pickRateVsSuccess: [],
    deadPicks: [],
  };
}
