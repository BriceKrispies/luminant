/**
 * Strategy analysis and reporting.
 * Surfaces patterns from batch simulation results.
 *
 * - Most common early upgrade picks
 * - Most successful full build paths
 * - Weapon path → score correlation
 * - Policy-specific tendencies
 * - Strategy signatures
 */

/**
 * Analyze an array of run results.
 * @param {Array} results — run result objects from game-runner
 * @returns {Object} — analysis report
 */
export function analyzeResults(results) {
  if (results.length === 0) return emptyAnalysis();

  return {
    earlyUpgradePicks: analyzeEarlyPicks(results),
    topUpgradePaths: analyzeUpgradePaths(results),
    weaponPerformance: analyzeWeaponPerformance(results),
    policyComparison: analyzePolicyComparison(results),
    strategySignatures: extractSignatures(results),
    upgradeCorrelations: analyzeUpgradeCorrelations(results),
  };
}

/**
 * Most common first 3 upgrade picks and their success rate.
 */
function analyzeEarlyPicks(results) {
  const pickCounts = {};
  const pickScores = {};

  for (const r of results) {
    const path = r.upgradePath || [];
    for (let i = 0; i < Math.min(3, path.length); i++) {
      const key = `pick${i + 1}:${path[i]}`;
      pickCounts[key] = (pickCounts[key] || 0) + 1;
      if (!pickScores[key]) pickScores[key] = [];
      pickScores[key].push(r.score);
    }
  }

  return Object.entries(pickCounts)
    .map(([key, count]) => ({
      pick: key,
      count,
      avgScore: mean(pickScores[key]),
      pct: Math.round(count / results.length * 100),
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Full upgrade path analysis — group by build signature and score.
 */
function analyzeUpgradePaths(results) {
  const pathGroups = {};

  for (const r of results) {
    const path = (r.upgradePath || []).join(' → ');
    if (!pathGroups[path]) pathGroups[path] = { count: 0, scores: [], seeds: [] };
    pathGroups[path].count++;
    pathGroups[path].scores.push(r.score);
    pathGroups[path].seeds.push(r.seed);
  }

  return Object.entries(pathGroups)
    .map(([path, data]) => ({
      path: path || '(none)',
      count: data.count,
      avgScore: mean(data.scores),
      bestScore: Math.max(...data.scores),
      bestSeed: data.seeds[data.scores.indexOf(Math.max(...data.scores))],
    }))
    .sort((a, b) => b.avgScore - a.avgScore);
}

/**
 * Weapon choice → performance correlation.
 */
function analyzeWeaponPerformance(results) {
  const weaponGroups = {};

  for (const r of results) {
    const weapon = (r.weaponPath || [])[0] || 'none';
    if (!weaponGroups[weapon]) weaponGroups[weapon] = { count: 0, scores: [], times: [], levels: [] };
    weaponGroups[weapon].count++;
    weaponGroups[weapon].scores.push(r.score);
    weaponGroups[weapon].times.push(r.survivalTime);
    weaponGroups[weapon].levels.push(r.level);
  }

  return Object.entries(weaponGroups)
    .map(([weapon, data]) => ({
      weapon,
      count: data.count,
      avgScore: mean(data.scores),
      avgTime: mean(data.times),
      avgLevel: mean(data.levels),
    }))
    .sort((a, b) => b.avgScore - a.avgScore);
}

/**
 * Compare different policies if results contain mixed policy data.
 */
function analyzePolicyComparison(results) {
  const policyGroups = {};

  for (const r of results) {
    const pid = r.policyId || 'unknown';
    if (!policyGroups[pid]) policyGroups[pid] = { count: 0, scores: [], times: [], levels: [], kills: [] };
    const g = policyGroups[pid];
    g.count++;
    g.scores.push(r.score);
    g.times.push(r.survivalTime);
    g.levels.push(r.level);
    g.kills.push(r.kills);
  }

  return Object.entries(policyGroups)
    .map(([policy, data]) => ({
      policy,
      count: data.count,
      avgScore: mean(data.scores),
      avgTime: mean(data.times),
      avgLevel: mean(data.levels),
      avgKills: mean(data.kills),
    }))
    .sort((a, b) => b.avgScore - a.avgScore);
}

/**
 * Extract "strategy signatures" — clusters of upgrade patterns.
 * Groups runs by first 3 picks to form a build identity.
 */
function extractSignatures(results) {
  const sigs = {};

  for (const r of results) {
    const path = r.upgradePath || [];
    const sig = path.slice(0, 3).join('+') || 'empty';
    if (!sigs[sig]) sigs[sig] = { count: 0, scores: [], fullPaths: [] };
    sigs[sig].count++;
    sigs[sig].scores.push(r.score);
    sigs[sig].fullPaths.push(path.join(' → '));
  }

  return Object.entries(sigs)
    .map(([sig, data]) => ({
      signature: sig,
      count: data.count,
      avgScore: mean(data.scores),
      bestScore: Math.max(...data.scores),
      pct: Math.round(data.count / results.length * 100),
    }))
    .sort((a, b) => b.avgScore - a.avgScore);
}

/**
 * Analyze which individual upgrades correlate with higher scores.
 */
function analyzeUpgradeCorrelations(results) {
  const upgradeScores = {};

  for (const r of results) {
    const seen = new Set(r.upgradePath || []);
    for (const upg of seen) {
      if (!upgradeScores[upg]) upgradeScores[upg] = { with: [], without: [] };
      upgradeScores[upg].with.push(r.score);
    }
    // Track "without" for upgrades we've seen in other runs
    for (const upg of Object.keys(upgradeScores)) {
      if (!seen.has(upg)) {
        upgradeScores[upg].without.push(r.score);
      }
    }
  }

  return Object.entries(upgradeScores)
    .filter(([, data]) => data.with.length >= 2 && data.without.length >= 2)
    .map(([upgrade, data]) => ({
      upgrade,
      withCount: data.with.length,
      withAvgScore: mean(data.with),
      withoutAvgScore: mean(data.without),
      lift: mean(data.with) - mean(data.without),
    }))
    .sort((a, b) => b.lift - a.lift);
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function emptyAnalysis() {
  return {
    earlyUpgradePicks: [],
    topUpgradePaths: [],
    weaponPerformance: [],
    policyComparison: [],
    strategySignatures: [],
    upgradeCorrelations: [],
  };
}
