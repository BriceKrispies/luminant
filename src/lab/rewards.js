/**
 * Structured reward shaping for simulation lab.
 * Computes per-component reward breakdown for each run.
 *
 * Each component has a name, raw value, weight, and weighted contribution.
 * The total reward is the sum of all weighted components.
 *
 * This is separate from scoring.js — scoring is a single fitness number,
 * rewards are a structured breakdown for analysis and tuning.
 */

/** Default reward component weights */
export const DEFAULT_REWARD_WEIGHTS = {
  survival: 1.0,
  kills: 0.1,
  eliteKills: 5.0,
  xp: 0.05,
  damagePenalty: -0.5,
  wastedUpgrade: -10.0,
  crowdControl: 2.0,
  consistency: 15.0,
  moments: 1.0,
};

/**
 * Compute structured reward breakdown from a run result.
 *
 * @param {Object} result — structured run result from game-runner
 * @param {Object} [result.upgradeHistory] — array of {tick, level, chosen, options}
 * @param {Object} [result.snapshots] — periodic snapshots
 * @param {Object} [weights] — override default component weights
 * @param {Object} [options]
 * @param {Object[]} [options.moments] — triggered moments from moment detector
 * @param {number} [options.momentRewardScale=1.0] — scale factor for moment reward
 * @returns {Object} — { total, components: [{name, raw, weight, contribution}] }
 */
export function computeRewardBreakdown(result, weights = DEFAULT_REWARD_WEIGHTS, options = {}) {
  const w = { ...DEFAULT_REWARD_WEIGHTS, ...weights };
  const components = [];

  // 1. Survival reward — seconds survived
  const survivalRaw = result.survivalTime || 0;
  components.push({
    name: 'survival',
    raw: survivalRaw,
    weight: w.survival,
    contribution: survivalRaw * w.survival,
  });

  // 2. Kill reward
  const killsRaw = result.kills || 0;
  components.push({
    name: 'kills',
    raw: killsRaw,
    weight: w.kills,
    contribution: killsRaw * w.kills,
  });

  // 3. Elite/high-threat kill reward
  const eliteKillsRaw = result.eliteKills || 0;
  components.push({
    name: 'eliteKills',
    raw: eliteKillsRaw,
    weight: w.eliteKills,
    contribution: eliteKillsRaw * w.eliteKills,
  });

  // 4. XP reward
  const xpRaw = result.totalXP || 0;
  components.push({
    name: 'xp',
    raw: xpRaw,
    weight: w.xp,
    contribution: xpRaw * w.xp,
  });

  // 5. Damage taken penalty
  const damageRaw = result.damageTaken || 0;
  components.push({
    name: 'damagePenalty',
    raw: damageRaw,
    weight: w.damagePenalty,
    contribution: damageRaw * w.damagePenalty,
  });

  // 6. Wasted/dead upgrade penalty
  const wastedCount = countWastedUpgrades(result);
  components.push({
    name: 'wastedUpgrade',
    raw: wastedCount,
    weight: w.wastedUpgrade,
    contribution: wastedCount * w.wastedUpgrade,
  });

  // 7. Crowd control / multi-hit opportunity reward
  const ccRaw = estimateCrowdControlValue(result);
  components.push({
    name: 'crowdControl',
    raw: ccRaw,
    weight: w.crowdControl,
    contribution: ccRaw * w.crowdControl,
  });

  // 8. Consistency / stability metric
  const consistencyRaw = computeConsistency(result);
  components.push({
    name: 'consistency',
    raw: consistencyRaw,
    weight: w.consistency,
    contribution: consistencyRaw * w.consistency,
  });

  // 9. Moment reward — aggregate weight of triggered gameplay moments
  const momentsList = options.moments || [];
  const momentScale = options.momentRewardScale || 1.0;
  let momentRaw = 0;
  for (const m of momentsList) {
    momentRaw += m.weight || 0;
  }
  momentRaw *= momentScale;
  components.push({
    name: 'moments',
    raw: momentRaw,
    weight: w.moments,
    contribution: momentRaw * w.moments,
  });

  const total = components.reduce((sum, c) => sum + c.contribution, 0);

  return {
    total: Math.round(total * 100) / 100,
    components,
  };
}

/**
 * Count upgrades that were likely wasted.
 * A "wasted" upgrade: heal_now at full HP, duplicate max-stack picks,
 * or weapon switches after already having a signature upgrade for another weapon.
 */
function countWastedUpgrades(result) {
  const history = result.upgradeHistory || [];
  const snapshots = result.snapshots || [];
  let wasted = 0;

  const picked = [];
  for (const entry of history) {
    const id = entry.chosen;

    // Detect heal_now at near-full HP via snapshots
    if (id === 'heal_now' && snapshots.length > 0) {
      const nearSnap = findNearestSnapshot(snapshots, entry.tick);
      if (nearSnap && nearSnap.hp / nearSnap.maxHp > 0.85) {
        wasted++;
      }
    }

    picked.push(id);
  }

  return wasted;
}

/**
 * Estimate crowd-control / multi-hit value from the run.
 * Uses kills-per-wave-time as a proxy for how well the bot
 * exploited AOE/cluster opportunities.
 */
function estimateCrowdControlValue(result) {
  const kills = result.kills || 0;
  const time = result.survivalTime || 1;
  const wave = result.wave || 1;

  // Kill rate scales with wave — higher waves should have higher kill rates
  const killRate = kills / time;
  const expectedRate = wave * 0.3;

  // Excess kill rate above expectation = good crowd control
  return Math.max(0, killRate - expectedRate) * time * 0.1;
}

/**
 * Compute a consistency metric from snapshots.
 * Low variance in HP ratio across snapshots = more consistent play.
 * Returns 0-1 where 1 = perfectly consistent.
 */
function computeConsistency(result) {
  const snapshots = result.snapshots || [];
  if (snapshots.length < 3) {
    // Without snapshots, derive from final stats
    const hpRatio = (result.damageTaken || 0) > 0
      ? 1 - Math.min(1, (result.damageTaken || 0) / ((result.level || 1) * 100))
      : 1;
    return Math.max(0, hpRatio);
  }

  const hpRatios = snapshots.map(s => s.hp / Math.max(s.maxHp, 1));

  const mean = hpRatios.reduce((a, b) => a + b, 0) / hpRatios.length;
  const variance = hpRatios.reduce((sum, r) => sum + (r - mean) ** 2, 0) / hpRatios.length;
  const stdDev = Math.sqrt(variance);

  // Low stdDev + high mean = consistent healthy play
  return Math.max(0, Math.min(1, mean * (1 - stdDev)));
}

function findNearestSnapshot(snapshots, tick) {
  let best = null;
  let bestDist = Infinity;
  for (const s of snapshots) {
    const dist = Math.abs(s.tick - tick);
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  return best;
}

/**
 * Merge two reward breakdowns by summing components (for averaging later).
 */
export function mergeRewardBreakdowns(a, b) {
  const merged = { total: a.total + b.total, components: [] };
  for (let i = 0; i < a.components.length; i++) {
    merged.components.push({
      name: a.components[i].name,
      raw: a.components[i].raw + b.components[i].raw,
      weight: a.components[i].weight,
      contribution: a.components[i].contribution + b.components[i].contribution,
    });
  }
  return merged;
}

/**
 * Average a merged reward breakdown by dividing by count.
 */
export function averageRewardBreakdown(merged, count) {
  return {
    total: Math.round((merged.total / count) * 100) / 100,
    components: merged.components.map(c => ({
      name: c.name,
      raw: Math.round((c.raw / count) * 100) / 100,
      weight: c.weight,
      contribution: Math.round((c.contribution / count) * 100) / 100,
    })),
  };
}
