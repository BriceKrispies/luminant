/**
 * Replay support for simulation lab.
 * Re-runs a recorded run from its seed + stored upgrade decisions.
 *
 * ## Determinism model
 *
 * Replay is "seed-deterministic" — given the same seed, the engine
 * produces the same simulation. The replay system:
 *
 * 1. Seeds the PRNG with the original run's seed
 * 2. Creates the same bot policy from the stored bot config
 * 3. Runs the simulation headlessly
 * 4. Compares final stats to the original run's summary
 *
 * ## Known determinism gaps
 *
 * - Math.random is replaced with a seeded PRNG during simulation,
 *   but any code that caches random values across runs could diverge.
 * - If the game code is modified between record and replay, results
 *   will differ (no versioning of game logic).
 * - Floating-point ordering differences across platforms could cause
 *   micro-divergence in long runs (>10k ticks).
 * - The replay does NOT force the same upgrade choices — it creates
 *   the same policy which should make the same choices given the same
 *   observations. If you need forced upgrades, use replayWithForcedUpgrades().
 *
 * ## Verification
 *
 * After replay, call verifyReplay() to check if the replay matches
 * the original run within tolerance.
 */

import { runGame } from '../ai/game-runner.js';
import { createBotPolicy, deserializeBotConfig } from './bot.js';
import { computeRewardBreakdown } from './rewards.js';
import { createRunRecorder } from './run-recorder.js';

/**
 * Replay a recorded run from its artifact.
 *
 * @param {Object} artifact — run artifact from run-recorder
 * @param {Object} [options]
 * @param {Object} [options.wasm] — pre-loaded WASM exports
 * @param {number} [options.maxTicks=30000]
 * @param {boolean} [options.silent=true]
 * @returns {Object} — { result, artifact: replayArtifact, verification }
 */
export async function replayRun(artifact, options = {}) {
  const { wasm, maxTicks = 30000, silent = true } = options;

  const botConfig = deserializeBotConfig(artifact.botConfig);
  const policy = createBotPolicy(botConfig);

  const result = await runGame({
    policy,
    seed: artifact.seed,
    maxTicks,
    wasm,
    recordSnapshots: true,
    snapshotInterval: artifact.snapshotInterval || 300,
    silent,
  });

  const rewardBreakdown = computeRewardBreakdown(result);
  const verification = verifyReplay(artifact, result);

  const recorder = createRunRecorder({
    runId: `replay-${artifact.runId}`,
    parentRunId: artifact.runId,
    generation: artifact.generation,
    seed: artifact.seed,
    botConfig: artifact.botConfig,
    snapshotInterval: artifact.snapshotInterval || 300,
  });

  const replayArtifact = recorder.finalize(result, rewardBreakdown);

  return {
    result,
    artifact: replayArtifact,
    verification,
  };
}

/**
 * Replay with forced upgrade choices from the original run.
 * Creates a wrapper policy that overrides chooseUpgrade with
 * the recorded sequence.
 *
 * @param {Object} artifact — run artifact
 * @param {Object} [options] — same as replayRun
 * @returns {Object}
 */
export async function replayWithForcedUpgrades(artifact, options = {}) {
  const { wasm, maxTicks = 30000, silent = true } = options;

  const botConfig = deserializeBotConfig(artifact.botConfig);
  const basePolicy = createBotPolicy(botConfig);

  // Upgrade sequence from the original run
  const upgradeSequence = (artifact.upgradeChoices || []).map(u => u.chosen);
  let upgradeIndex = 0;

  const forcedPolicy = {
    ...basePolicy,
    name: basePolicy.name + ' (forced)',
    id: basePolicy.id + '-forced',

    chooseUpgrade(choices, obs) {
      if (upgradeIndex < upgradeSequence.length) {
        const forced = upgradeSequence[upgradeIndex++];
        // Only use the forced choice if it's actually available
        if (choices.some(c => c.id === forced)) {
          return forced;
        }
      }
      return basePolicy.chooseUpgrade(choices, obs);
    },
  };

  const result = await runGame({
    policy: forcedPolicy,
    seed: artifact.seed,
    maxTicks,
    wasm,
    recordSnapshots: true,
    snapshotInterval: artifact.snapshotInterval || 300,
    silent,
  });

  const rewardBreakdown = computeRewardBreakdown(result);
  const verification = verifyReplay(artifact, result);

  return {
    result,
    verification,
    reward: rewardBreakdown,
  };
}

/**
 * Verify that a replay matches the original run.
 * Checks key metrics within tolerance.
 *
 * @param {Object} original — original run artifact
 * @param {Object} replayResult — result from runGame
 * @returns {Object} — { match, diffs, tolerance }
 */
export function verifyReplay(original, replayResult) {
  const orig = original.summary || original;
  const replay = replayResult;

  const diffs = {};
  let match = true;

  // Check key metrics
  const checks = [
    ['kills', 0],
    ['level', 0],
    ['wave', 0],
    ['survived', 0],
  ];

  for (const [key, tolerance] of checks) {
    const origVal = orig[key];
    const replayVal = replay[key];
    const diff = typeof origVal === 'boolean'
      ? (origVal !== replayVal ? 1 : 0)
      : Math.abs((origVal || 0) - (replayVal || 0));

    diffs[key] = { original: origVal, replay: replayVal, diff };
    if (diff > tolerance) match = false;
  }

  // Survival time can diverge slightly due to floating point
  const timeDiff = Math.abs((orig.survivalTime || 0) - (replay.survivalTime || 0));
  diffs.survivalTime = {
    original: orig.survivalTime,
    replay: replay.survivalTime,
    diff: timeDiff,
  };
  if (timeDiff > 1.0) match = false;

  // Upgrade path comparison
  const origPath = orig.upgradePath || [];
  const replayPath = replay.upgradePath || [];
  const pathMatch = origPath.length === replayPath.length &&
    origPath.every((id, i) => id === replayPath[i]);
  diffs.upgradePath = {
    original: origPath,
    replay: replayPath,
    match: pathMatch,
  };
  if (!pathMatch) match = false;

  return {
    match,
    diffs,
    note: match
      ? 'Replay matches original run exactly.'
      : 'Replay diverged from original — see diffs for details.',
  };
}

/**
 * Compare a parent and child run from an evolutionary experiment.
 * Highlights what changed in the child's config and how outcomes differed.
 *
 * @param {Object} parent — parent run artifact
 * @param {Object} child — child run artifact
 * @returns {Object} — comparison with config diff
 */
export function compareParentChild(parent, child) {
  const base = compareRuns(parent, child);

  // Config diff
  const parentWeights = parent.botConfig?.weights || {};
  const childWeights = child.botConfig?.weights || {};
  const weightDiffs = {};

  for (const key of Object.keys(parentWeights)) {
    if (key === 'upgradeWeights') continue;
    const pv = parentWeights[key] || 0;
    const cv = childWeights[key] || 0;
    if (Math.abs(pv - cv) > 0.001) {
      weightDiffs[key] = { parent: pv, child: cv, delta: round3(cv - pv) };
    }
  }

  // Upgrade weight diffs
  const puw = parentWeights.upgradeWeights || {};
  const cuw = childWeights.upgradeWeights || {};
  for (const key of Object.keys(puw)) {
    const pv = puw[key] || 0;
    const cv = cuw[key] || 0;
    if (Math.abs(pv - cv) > 0.001) {
      weightDiffs[`upgrade.${key}`] = { parent: pv, child: cv, delta: round3(cv - pv) };
    }
  }

  base.configDiff = weightDiffs;
  base.generation = {
    parent: parent.generation || 0,
    child: child.generation || 0,
  };

  return base;
}

/**
 * Compare generation winners across an experiment.
 * Shows how the best candidate improved across generations.
 *
 * @param {Object[]} generationArtifacts — from experiment
 * @returns {Object} — cross-generation comparison
 */
export function compareGenerationWinners(generationArtifacts) {
  const winners = generationArtifacts
    .filter(g => g.candidates && g.candidates.length > 0)
    .map(g => ({
      generation: g.generation,
      name: g.candidates[0].name,
      avgReward: g.candidates[0].avgReward,
      config: g.candidates[0].config,
      outcome: g.candidates[0].avgOutcome,
    }));

  const improvements = [];
  for (let i = 1; i < winners.length; i++) {
    improvements.push({
      fromGen: winners[i - 1].generation,
      toGen: winners[i].generation,
      rewardDelta: round2(winners[i].avgReward - winners[i - 1].avgReward),
      improved: winners[i].avgReward > winners[i - 1].avgReward,
    });
  }

  return { winners, improvements };
}

/**
 * Compare two run artifacts side by side.
 *
 * @param {Object} a — first run artifact
 * @param {Object} b — second run artifact
 * @returns {Object} — comparison summary
 */
export function compareRuns(a, b) {
  const sa = a.summary || a;
  const sb = b.summary || b;

  const metrics = ['survivalTime', 'kills', 'level', 'wave', 'totalXP', 'damageTaken', 'score'];
  const comparison = {};

  for (const key of metrics) {
    const va = sa[key] || 0;
    const vb = sb[key] || 0;
    comparison[key] = {
      a: va,
      b: vb,
      diff: vb - va,
      pctDiff: va !== 0 ? Math.round(((vb - va) / va) * 100) : (vb !== 0 ? 100 : 0),
    };
  }

  // Upgrade path comparison
  const pathA = sa.upgradePath || [];
  const pathB = sb.upgradePath || [];
  const sharedUpgrades = pathA.filter(id => pathB.includes(id));

  comparison.upgradePath = {
    a: pathA,
    b: pathB,
    shared: sharedUpgrades,
    onlyA: pathA.filter(id => !pathB.includes(id)),
    onlyB: pathB.filter(id => !pathA.includes(id)),
  };

  // Reward comparison
  if (a.reward && b.reward) {
    comparison.reward = {};
    for (const comp of a.reward.components) {
      const bComp = b.reward.components.find(c => c.name === comp.name);
      if (bComp) {
        comparison.reward[comp.name] = {
          a: comp.contribution,
          b: bComp.contribution,
          diff: bComp.contribution - comp.contribution,
        };
      }
    }
  }

  return {
    runIdA: a.runId,
    runIdB: b.runId,
    winner: (sa.score || 0) >= (sb.score || 0) ? 'a' : 'b',
    comparison,
  };
}

function round2(v) { return Math.round(v * 100) / 100; }
function round3(v) { return Math.round(v * 1000) / 1000; }
