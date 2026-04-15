/**
 * Tests for the Simulation Lab subsystem.
 * Covers: bot config, mutation, rewards, lineage, analytics,
 * run recording, replay verification, and batch integration.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadEngine } from '../src/engine/loader.js';
import { runGame } from '../src/ai/game-runner.js';

// Lab modules
import {
  createBotConfig, createBotPolicy, mutateBotConfig,
  serializeBotConfig, deserializeBotConfig,
  BIAS_PRESETS, LAB_BASE_WEIGHTS, MUTABLE_KEYS,
} from '../src/lab/bot.js';
import { computeRewardBreakdown, DEFAULT_REWARD_WEIGHTS } from '../src/lab/rewards.js';
import { createRunRecorder, generateRunId, serializeArtifact, deserializeArtifact } from '../src/lab/run-recorder.js';
import { createLineageTree } from '../src/lab/lineage.js';
import { analyzeUpgrades, formatAnalyticsSummary } from '../src/lab/analytics.js';
import { verifyReplay, compareRuns } from '../src/lab/replay.js';
import { runLabSim, runLabBatch } from '../src/lab/lab-runner.js';

// Register policies
import '../src/ai/policies/survival.js';
import '../src/ai/policies/progression.js';
import '../src/systems/player-ai/policies/brawler.js';
import '../src/systems/player-ai/policies/kiter.js';
import '../src/systems/player-ai/policies/coward.js';
import '../src/systems/player-ai/policies/farmer.js';

let wasm;

beforeAll(async () => {
  wasm = await loadEngine();
});

// ── Bot Policy ──

describe('Bot Config', () => {
  it('creates a default config with base weights', () => {
    const config = createBotConfig();
    expect(config.name).toBe('lab-bot');
    expect(config.weights).toBeDefined();
    expect(config.weights.flee).toBe(LAB_BASE_WEIGHTS.flee);
    expect(config.weights.upgradeWeights).toBeDefined();
  });

  it('applies bias presets', () => {
    const config = createBotConfig({ biases: ['survival'] });
    expect(config.weights.flee).toBe(BIAS_PRESETS.survival.flee);
    expect(config.biases).toContain('survival');
  });

  it('layers multiple biases', () => {
    const config = createBotConfig({ biases: ['survival', 'xp_collection'] });
    // xp_collection overrides collect_xp from survival's base
    expect(config.weights.collect_xp).toBe(BIAS_PRESETS.xp_collection.collect_xp);
    expect(config.biases).toContain('survival');
    expect(config.biases).toContain('xp_collection');
  });

  it('applies direct overrides', () => {
    const config = createBotConfig({ overrides: { flee: 99 } });
    expect(config.weights.flee).toBe(99);
  });

  it('creates a valid policy from config', () => {
    const config = createBotConfig({ biases: ['aoe_opportunity'] });
    const policy = createBotPolicy(config);
    expect(typeof policy.act).toBe('function');
    expect(typeof policy.reset).toBe('function');
    expect(typeof policy.chooseUpgrade).toBe('function');
    expect(policy.name).toBeTruthy();
    expect(policy.id).toBeTruthy();
  });

  it('serializes and deserializes round-trip', () => {
    const config = createBotConfig({ name: 'test', biases: ['elite_targeting'] });
    const json = serializeBotConfig(config);
    const restored = deserializeBotConfig(json);
    expect(restored.name).toBe('test');
    expect(restored.weights.boss_focus).toBe(config.weights.boss_focus);
    expect(restored.biases).toContain('elite_targeting');
  });
});

describe('Bot Mutation', () => {
  it('produces a child config without corrupting parent', () => {
    const parent = createBotConfig({ name: 'parent', biases: ['survival'] });
    const parentFleeOrig = parent.weights.flee;

    const child = mutateBotConfig(parent, { mutationRate: 1.0, mutationScale: 0.5 });

    // Parent unchanged
    expect(parent.weights.flee).toBe(parentFleeOrig);
    expect(parent.name).toBe('parent');

    // Child is different
    expect(child.name).toBe('parent-m');
    expect(child.weights).toBeDefined();
  });

  it('respects RNG for deterministic mutation', () => {
    const parent = createBotConfig({ biases: ['keep_distance'] });
    let callCount = 0;
    const rng = () => { callCount++; return 0.5; };

    const childA = mutateBotConfig(parent, { mutationRate: 1.0, mutationScale: 0.1, rng });
    const savedCount = callCount;
    callCount = 0;
    const childB = mutateBotConfig(parent, { mutationRate: 1.0, mutationScale: 0.1, rng });

    // Same RNG produces same output
    expect(childA.weights.flee).toBe(childB.weights.flee);
    expect(callCount).toBe(savedCount);
  });

  it('does not produce out-of-range values', () => {
    const parent = createBotConfig();
    for (let i = 0; i < 20; i++) {
      const child = mutateBotConfig(parent, { mutationRate: 1.0, mutationScale: 1.0 });
      expect(child.weights.flee).toBeGreaterThanOrEqual(0);
      expect(child.weights.flee).toBeLessThanOrEqual(4);
      expect(child.weights.retreatThreshold).toBeGreaterThanOrEqual(0.05);
      expect(child.weights.retreatThreshold).toBeLessThanOrEqual(0.7);
    }
  });
});

// ── Reward Shaping ──

describe('Reward Breakdown', () => {
  it('computes structured reward from a run result', () => {
    const result = {
      survivalTime: 120,
      kills: 50,
      eliteKills: 2,
      totalXP: 300,
      damageTaken: 80,
      level: 5,
      wave: 3,
      survived: true,
      upgradeHistory: [],
      snapshots: [],
      upgradePath: ['shotgun_unlock', 'pierce'],
    };

    const breakdown = computeRewardBreakdown(result);

    expect(breakdown.total).toBeTypeOf('number');
    expect(breakdown.components).toBeInstanceOf(Array);
    expect(breakdown.components.length).toBe(9);

    // Check component names
    const names = breakdown.components.map(c => c.name);
    expect(names).toContain('survival');
    expect(names).toContain('kills');
    expect(names).toContain('eliteKills');
    expect(names).toContain('damagePenalty');
    expect(names).toContain('consistency');

    // Each component has required fields
    for (const c of breakdown.components) {
      expect(c).toHaveProperty('name');
      expect(c).toHaveProperty('raw');
      expect(c).toHaveProperty('weight');
      expect(c).toHaveProperty('contribution');
    }
  });

  it('total equals sum of contributions', () => {
    const result = { survivalTime: 60, kills: 20, totalXP: 100, damageTaken: 30, level: 3, wave: 2 };
    const breakdown = computeRewardBreakdown(result);
    const summed = breakdown.components.reduce((s, c) => s + c.contribution, 0);
    expect(Math.abs(breakdown.total - Math.round(summed * 100) / 100)).toBeLessThan(0.01);
  });

  it('damage penalty is negative', () => {
    const result = { survivalTime: 60, kills: 10, damageTaken: 100, level: 2 };
    const breakdown = computeRewardBreakdown(result);
    const dmg = breakdown.components.find(c => c.name === 'damagePenalty');
    expect(dmg.contribution).toBeLessThan(0);
  });
});

// ── Run Recorder ──

describe('Run Recorder', () => {
  it('generates unique run IDs', () => {
    const a = generateRunId();
    const b = generateRunId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^run-/);
  });

  it('records upgrades and events', () => {
    const rec = createRunRecorder({ seed: 42, botConfig: { name: 'test' } });

    rec.recordUpgrade({ tick: 100, level: 2, chosen: 'shotgun_unlock', options: ['shotgun_unlock', 'nova_unlock'] });
    rec.recordEvent({ type: 'custom', tick: 200, note: 'test event' });

    const result = { survivalTime: 60, kills: 10, level: 3, wave: 2, survived: true, upgradePath: ['shotgun_unlock'] };
    const reward = { total: 100, components: [] };
    const artifact = rec.finalize(result, reward);

    expect(artifact.runId).toMatch(/^run-/);
    expect(artifact.seed).toBe(42);
    expect(artifact.upgradeChoices.length).toBe(1);
    expect(artifact.upgradeChoices[0].chosen).toBe('shotgun_unlock');
    expect(artifact.events.length).toBeGreaterThanOrEqual(1);
    expect(artifact.summary.kills).toBe(10);
    expect(artifact.reward.total).toBe(100);
  });

  it('serializes and deserializes artifacts', () => {
    const rec = createRunRecorder({ seed: 1, botConfig: { name: 'x' } });
    const artifact = rec.finalize(
      { survivalTime: 30, kills: 5, level: 2, wave: 1, survived: false, upgradePath: [] },
      { total: 50, components: [] }
    );

    const json = serializeArtifact(artifact);
    expect(typeof json).toBe('string');
    const restored = deserializeArtifact(json);
    expect(restored.runId).toBe(artifact.runId);
    expect(restored.seed).toBe(1);
  });
});

// ── Lineage ──

describe('Lineage Tracking', () => {
  it('tracks parent/child relationships', () => {
    const tree = createLineageTree();

    tree.addRun({ runId: 'r1', parentRunId: null, generation: 0, summary: { score: 100 } });
    tree.addRun({ runId: 'r2', parentRunId: 'r1', generation: 1, summary: { score: 120 } });
    tree.addRun({ runId: 'r3', parentRunId: 'r1', generation: 1, summary: { score: 90 } });

    expect(tree.size()).toBe(3);
    expect(tree.getChildren('r1').length).toBe(2);
    expect(tree.getNode('r2').parentRunId).toBe('r1');
  });

  it('builds ancestry chain', () => {
    const tree = createLineageTree();
    tree.addRun({ runId: 'a', parentRunId: null, generation: 0, summary: {} });
    tree.addRun({ runId: 'b', parentRunId: 'a', generation: 1, summary: {} });
    tree.addRun({ runId: 'c', parentRunId: 'b', generation: 2, summary: {} });

    const ancestry = tree.getAncestry('c');
    expect(ancestry.length).toBe(3);
    expect(ancestry[0].runId).toBe('a');
    expect(ancestry[2].runId).toBe('c');
  });

  it('filters by generation', () => {
    const tree = createLineageTree();
    tree.addRun({ runId: 'g0a', generation: 0, summary: {} });
    tree.addRun({ runId: 'g1a', generation: 1, summary: {} });
    tree.addRun({ runId: 'g1b', generation: 1, summary: {} });

    expect(tree.getGeneration(1).length).toBe(2);
    expect(tree.maxGeneration()).toBe(1);
  });

  it('finds best per generation', () => {
    const tree = createLineageTree();
    tree.addRun({ runId: 'a', generation: 0, summary: { score: 50 } });
    tree.addRun({ runId: 'b', generation: 0, summary: { score: 80 } });
    tree.addRun({ runId: 'c', generation: 1, summary: { score: 100 } });

    const best = tree.getBestPerGeneration();
    expect(best.length).toBe(2);
    expect(best[0].runId).toBe('b');
    expect(best[1].runId).toBe('c');
  });

  it('serializes and loads round-trip', () => {
    const tree = createLineageTree();
    tree.addRun({ runId: 'x', parentRunId: null, generation: 0, summary: { score: 10 } });
    tree.addRun({ runId: 'y', parentRunId: 'x', generation: 1, summary: { score: 20 } });

    const data = tree.serialize();
    const tree2 = createLineageTree();
    tree2.load(data);

    expect(tree2.size()).toBe(2);
    expect(tree2.getNode('y').parentRunId).toBe('x');
  });
});

// ── Analytics ──

describe('Upgrade Analytics', () => {
  it('produces analytics from artifacts', () => {
    const artifacts = [
      makeArtifact({ upgradePath: ['shotgun_unlock', 'pierce', 'damage_1'], score: 200, wave: 5 }),
      makeArtifact({ upgradePath: ['nova_unlock', 'kill_shockwave', 'damage_1'], score: 250, wave: 6 }),
      makeArtifact({ upgradePath: ['shotgun_unlock', 'pierce', 'hp_1'], score: 150, wave: 4 }),
      makeArtifact({ upgradePath: ['nova_unlock', 'berserker', 'damage_1'], score: 300, wave: 7 }),
      makeArtifact({ upgradePath: ['sword_mastery', 'focus_fire'], score: 100, wave: 3 }),
    ];

    const report = analyzeUpgrades(artifacts);

    expect(report.sampleSize).toBe(5);
    expect(report.bestUpgradesByReward.length).toBeGreaterThan(0);
    expect(report.strongestFirstPick.length).toBeGreaterThan(0);
    expect(report.strongestPairings.length).toBeGreaterThan(0);
    expect(report.byWaveReached.length).toBeGreaterThan(0);
    expect(report.pickRateVsSuccess.length).toBeGreaterThan(0);
  });

  it('identifies dead picks', () => {
    const artifacts = [];
    // 'bad_upgrade' always appears in low-scoring runs
    for (let i = 0; i < 8; i++) {
      artifacts.push(makeArtifact({ upgradePath: ['bad_upgrade', 'hp_1'], score: 50, wave: 2 }));
    }
    for (let i = 0; i < 4; i++) {
      artifacts.push(makeArtifact({ upgradePath: ['shotgun_unlock', 'pierce'], score: 300, wave: 7 }));
    }

    const report = analyzeUpgrades(artifacts);
    const deadPick = report.deadPicks.find(d => d.upgrade === 'bad_upgrade');
    expect(deadPick).toBeDefined();
    expect(deadPick.rewardDelta).toBeLessThan(0);
  });

  it('formats human-readable summary', () => {
    const artifacts = [
      makeArtifact({ upgradePath: ['a', 'b'], score: 100, wave: 3 }),
      makeArtifact({ upgradePath: ['a', 'c'], score: 200, wave: 5 }),
      makeArtifact({ upgradePath: ['b', 'c'], score: 150, wave: 4 }),
      makeArtifact({ upgradePath: ['a', 'b', 'c'], score: 250, wave: 6 }),
    ];
    const report = analyzeUpgrades(artifacts);
    const text = formatAnalyticsSummary(report);
    expect(text).toContain('UPGRADE ANALYTICS');
    expect(text).toContain('Sample size: 4');
  });

  it('returns empty report for no artifacts', () => {
    const report = analyzeUpgrades([]);
    expect(report.sampleSize).toBe(0);
  });
});

// ── Replay Verification ──

describe('Replay Verification', () => {
  it('verifyReplay detects match', () => {
    const artifact = {
      summary: { survivalTime: 100, kills: 50, level: 5, wave: 3, survived: true, upgradePath: ['a', 'b'] },
    };
    const replayResult = { survivalTime: 100, kills: 50, level: 5, wave: 3, survived: true, upgradePath: ['a', 'b'] };

    const v = verifyReplay(artifact, replayResult);
    expect(v.match).toBe(true);
  });

  it('verifyReplay detects divergence', () => {
    const artifact = {
      summary: { survivalTime: 100, kills: 50, level: 5, wave: 3, survived: true, upgradePath: ['a', 'b'] },
    };
    const replayResult = { survivalTime: 100, kills: 45, level: 5, wave: 3, survived: true, upgradePath: ['a', 'b'] };

    const v = verifyReplay(artifact, replayResult);
    expect(v.match).toBe(false);
    expect(v.diffs.kills.diff).toBe(5);
  });

  it('compareRuns produces structured comparison', () => {
    const a = { runId: 'r1', summary: { survivalTime: 100, kills: 50, score: 200 }, reward: { total: 200, components: [{ name: 'survival', contribution: 100 }] } };
    const b = { runId: 'r2', summary: { survivalTime: 120, kills: 60, score: 250 }, reward: { total: 250, components: [{ name: 'survival', contribution: 120 }] } };

    const comp = compareRuns(a, b);
    expect(comp.winner).toBe('b');
    expect(comp.comparison.kills.diff).toBe(10);
  });
});

// ── Integration: Lab Runner ──

describe('Lab Runner Integration', () => {
  it('runs a single lab sim and produces artifact', async () => {
    const config = createBotConfig({ biases: ['survival'] });

    const { result, artifact } = await runLabSim({
      botConfig: config,
      seed: 12345,
      maxTicks: 600, // ~10 seconds — short for test
      wasm,
    });

    expect(result.seed).toBe(12345);
    expect(result.survivalTime).toBeGreaterThan(0);
    expect(artifact.runId).toMatch(/^run-/);
    expect(artifact.seed).toBe(12345);
    expect(artifact.botConfig.name).toBe('lab-bot');
    expect(artifact.summary.survivalTime).toBeGreaterThan(0);
    expect(artifact.reward).toBeDefined();
    expect(artifact.reward.total).toBeTypeOf('number');
    expect(artifact.reward.components.length).toBe(9);
  });

  it('runs a short batch and produces artifacts + analytics', async () => {
    const config = createBotConfig();

    const { artifacts, analytics, lineage, summary } = await runLabBatch({
      runs: 3,
      botConfig: config,
      startSeed: 42,
      maxTicks: 600,
      wasm,
    });

    expect(artifacts.length).toBe(3);
    expect(analytics.sampleSize).toBe(3);
    expect(lineage.size()).toBe(3);
    expect(summary.runs).toBe(3);
    expect(summary.avgReward).toBeTypeOf('number');

    // Each artifact is complete
    for (const art of artifacts) {
      expect(art.runId).toBeTruthy();
      expect(art.seed).toBeTypeOf('number');
      expect(art.reward).toBeDefined();
      expect(art.summary).toBeDefined();
    }
  });

  it('batch with mutation produces varied configs', async () => {
    const config = createBotConfig({ biases: ['aoe_opportunity'] });

    const { artifacts } = await runLabBatch({
      runs: 3,
      botConfig: config,
      startSeed: 100,
      maxTicks: 300,
      mutate: true,
      wasm,
    });

    // Mutation should produce different bot configs
    const configs = artifacts.map(a => JSON.stringify(a.botConfig.weights));
    const unique = new Set(configs);
    // At least 2 different configs (first is original, rest mutated)
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });

  it('deterministic replay from same seed produces same result', async () => {
    const config = createBotConfig({ biases: ['keep_distance'] });

    const { result: resultA } = await runLabSim({
      botConfig: config,
      seed: 99999,
      maxTicks: 600,
      wasm,
    });

    const { result: resultB } = await runLabSim({
      botConfig: config,
      seed: 99999,
      maxTicks: 600,
      wasm,
    });

    expect(resultA.kills).toBe(resultB.kills);
    expect(resultA.level).toBe(resultB.level);
    expect(resultA.wave).toBe(resultB.wave);
    expect(resultA.survived).toBe(resultB.survived);
    expect(Math.abs(resultA.survivalTime - resultB.survivalTime)).toBeLessThan(0.1);
  });
});

// ── Helpers ──

function makeArtifact({ upgradePath = [], score = 100, wave = 3, biases = [] } = {}) {
  return {
    runId: generateRunId(),
    botConfig: { name: 'test', biases },
    summary: {
      upgradePath,
      score,
      wave,
      kills: score / 2,
      level: wave + 1,
      survivalTime: wave * 30,
      totalXP: score * 2,
      damageTaken: score / 4,
      survived: wave > 4,
    },
    reward: {
      total: score,
      components: [
        { name: 'survival', raw: wave * 30, weight: 1, contribution: wave * 30 },
        { name: 'kills', raw: score / 2, weight: 0.1, contribution: score / 20 },
      ],
    },
  };
}
