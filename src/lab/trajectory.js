/**
 * Trajectory store for experiment/training architecture.
 *
 * A trajectory is a per-run record of the full observation-action-reward
 * stream at configurable detail levels. Trajectories are the primary
 * data artifact for policy analysis, replay, and future model training.
 *
 * Detail levels:
 * - 'summary' — only final outcome + periodic summaries (smallest)
 * - 'moments' — summary + all triggered moments + upgrades
 * - 'sampled' — moments + observations/actions at sample interval
 * - 'full'    — every tick's observation, action, reward, moments (largest)
 *
 * All trajectory data is JSON-serializable.
 */

/** @typedef {'summary'|'moments'|'sampled'|'full'} DetailLevel */

/**
 * Create a trajectory recorder for a single run.
 *
 * @param {Object} options
 * @param {string} options.runId
 * @param {DetailLevel} [options.detailLevel='sampled']
 * @param {number} [options.sampleInterval=30] — ticks between samples for 'sampled' level
 * @param {Object} [options.featureSchema] — from featurizer.getSchema()
 * @param {string} [options.policyId]
 * @param {Object} [options.policyParams] — serialized policy params
 * @param {string|null} [options.parentRunId]
 * @param {number} [options.generation=0]
 * @param {number} [options.seed]
 * @returns {TrajectoryRecorder}
 */
export function createTrajectoryRecorder(options) {
  const {
    runId,
    detailLevel = 'sampled',
    sampleInterval = 30,
    featureSchema = null,
    policyId = null,
    policyParams = null,
    parentRunId = null,
    generation = 0,
    seed = 0,
  } = options;

  const samples = [];       // tick-indexed observation+action records
  const moments = [];       // all triggered moments
  const upgrades = [];      // upgrade decisions
  const summaries = [];     // periodic summary snapshots
  const rewards = [];       // per-tick or per-sample reward values

  let tickCount = 0;
  let cumulativeReward = 0;
  let cumulativeMomentReward = 0;

  // Rolling stats for periodic summaries
  let summaryAccum = {
    ticks: 0,
    totalDamage: 0,
    kills: 0,
    moments: 0,
    reward: 0,
  };
  const SUMMARY_INTERVAL = 300; // every 5 seconds

  return {
    runId,
    detailLevel,

    /**
     * Record one tick of data.
     *
     * @param {Object} data
     * @param {number} data.tick
     * @param {number[]|null} data.features — feature vector (from featurizer)
     * @param {Object} data.action — { dx, dy, attack }
     * @param {number} data.reward — instant reward this tick
     * @param {Object[]} data.tickMoments — moments triggered this tick
     * @param {Object} [data.obs] — raw observation (only stored at 'full' level)
     */
    record(data) {
      const { tick, features, action, reward = 0, tickMoments = [], obs } = data;
      tickCount = tick;
      cumulativeReward += reward;

      // Always accumulate moments
      for (const m of tickMoments) {
        moments.push(m);
        cumulativeMomentReward += m.weight;
      }

      // Update summary accum
      summaryAccum.ticks++;
      summaryAccum.reward += reward;
      summaryAccum.moments += tickMoments.length;
      if (obs) {
        summaryAccum.totalDamage += obs.recentDamageTaken || 0;
        summaryAccum.kills = obs.totalKills || summaryAccum.kills;
      }

      // Periodic summary
      if (tick > 0 && tick % SUMMARY_INTERVAL === 0) {
        summaries.push({
          tick,
          ...summaryAccum,
          cumulativeReward,
          cumulativeMomentReward,
        });
        summaryAccum = { ticks: 0, totalDamage: 0, kills: summaryAccum.kills, moments: 0, reward: 0 };
      }

      // Detail-level gating
      if (detailLevel === 'summary') return;
      if (detailLevel === 'moments') return; // moments already captured above

      if (detailLevel === 'sampled') {
        if (tick % sampleInterval !== 0) return;
      }

      // Record sample (for 'sampled' and 'full')
      const sample = { tick, reward };
      if (features) {
        sample.features = Array.isArray(features) ? features : Array.from(features);
      }
      if (action) {
        sample.action = { dx: action.dx, dy: action.dy, attack: action.attack ? 1 : 0 };
      }
      samples.push(sample);
    },

    /**
     * Record an upgrade decision.
     */
    recordUpgrade(entry) {
      upgrades.push({
        tick: entry.tick,
        level: entry.level,
        chosen: entry.chosen,
        options: entry.options || [],
      });
    },

    /**
     * Finalize trajectory and produce serializable artifact.
     *
     * @param {Object} outcome — final run result
     * @returns {Object} — trajectory artifact
     */
    finalize(outcome) {
      return {
        type: 'trajectory',
        version: 1,
        runId,
        parentRunId,
        generation,
        seed,
        policyId,
        policyParams,
        featureSchema,
        detailLevel,
        sampleInterval: detailLevel === 'sampled' ? sampleInterval : null,

        tickCount,
        cumulativeReward: round2(cumulativeReward),
        cumulativeMomentReward: round2(cumulativeMomentReward),

        outcome: {
          survivalTime: outcome.survivalTime || 0,
          survived: outcome.survived || false,
          kills: outcome.kills || 0,
          level: outcome.level || 0,
          wave: outcome.wave || 0,
          totalXP: outcome.totalXP || 0,
          damageTaken: outcome.damageTaken || 0,
          score: outcome.score || 0,
          upgradePath: outcome.upgradePath || [],
        },

        samples: detailLevel === 'summary' ? [] : samples,
        moments,
        upgrades,
        summaries,

        meta: {
          recordedAt: new Date().toISOString(),
          sampleCount: samples.length,
          momentCount: moments.length,
          upgradeCount: upgrades.length,
          summaryCount: summaries.length,
        },
      };
    },
  };
}

/**
 * Compute trajectory statistics for analysis.
 *
 * @param {Object} trajectory — finalized trajectory artifact
 * @returns {Object} — stats summary
 */
export function trajectoryStats(trajectory) {
  const { samples, moments, summaries, outcome } = trajectory;

  // Reward curve from summaries
  const rewardCurve = summaries.map(s => ({
    tick: s.tick,
    reward: s.cumulativeReward,
    momentReward: s.cumulativeMomentReward,
  }));

  // Moment frequency
  const momentCounts = {};
  for (const m of moments) {
    momentCounts[m.id] = (momentCounts[m.id] || 0) + 1;
  }

  // Moment timeline (binned by 300-tick windows)
  const momentTimeline = {};
  for (const m of moments) {
    const bin = Math.floor(m.tick / 300) * 300;
    if (!momentTimeline[bin]) momentTimeline[bin] = [];
    momentTimeline[bin].push(m.id);
  }

  // Action distribution from samples
  let attackFrames = 0;
  let moveFrames = 0;
  let holdFrames = 0;
  for (const s of samples) {
    if (!s.action) continue;
    if (s.action.attack) attackFrames++;
    if (Math.abs(s.action.dx) > 0.1 || Math.abs(s.action.dy) > 0.1) {
      moveFrames++;
    } else {
      holdFrames++;
    }
  }
  const totalFrames = Math.max(samples.length, 1);

  return {
    runId: trajectory.runId,
    tickCount: trajectory.tickCount,
    cumulativeReward: trajectory.cumulativeReward,
    cumulativeMomentReward: trajectory.cumulativeMomentReward,
    outcome,
    rewardCurve,
    momentCounts,
    momentTimeline,
    actionDistribution: {
      attackRate: round2(attackFrames / totalFrames),
      moveRate: round2(moveFrames / totalFrames),
      holdRate: round2(holdFrames / totalFrames),
    },
    sampleCount: samples.length,
    momentCount: moments.length,
  };
}

function round2(v) { return Math.round(v * 100) / 100; }
