/**
 * Tests for the Experiment/Training architecture.
 * Covers: featurizer, moments, trajectory, experiment config,
 * training backend, population analysis, replay enhancements.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadEngine } from '../src/engine/loader.js';

// New modules
import {
  createFeaturizer, FEATURE_SCHEMA_VERSION,
  FEATURE_COUNT, ALL_LABELS, FEATURE_GROUPS,
} from '../src/lab/featurizer.js';
import {
  createMomentDetector, registerMoment, getMomentDefs,
  getMomentDef, computeMomentReward, summarizeMoments,
  MOMENT_DEFS,
} from '../src/lab/moments.js';
import {
  createTrajectoryRecorder, trajectoryStats,
} from '../src/lab/trajectory.js';
import {
  createExperimentConfig, validateExperimentConfig,
  createGenerationArtifact, createExperimentSummary, getSeed,
} from '../src/lab/experiment.js';
import {
  initializePopulation, selectAndMutate, evaluatePopulation,
} from '../src/lab/training.js';
import {
  analyzeParameterCorrelation, analyzeMomentCorrelation,
  analyzeUpgradeCorrelation, analyzeCandidateDominance,
  analyzeConvergence, fullPopulationAnalysis,
} from '../src/lab/population-analysis.js';
import {
  compareParentChild, compareGenerationWinners,
} from '../src/lab/replay.js';
import { computeRewardBreakdown } from '../src/lab/rewards.js';
import { createBotConfig, mutateBotConfig } from '../src/lab/bot.js';

// Register policies
import '../src/ai/policies/survival.js';
import '../src/systems/player-ai/policies/brawler.js';

let wasm;

beforeAll(async () => {
  wasm = await loadEngine();
});

// ── Featurizer ──

describe('Featurizer', () => {
  it('creates with correct schema version and feature count', () => {
    const f = createFeaturizer();
    expect(f.schemaVersion).toBe(FEATURE_SCHEMA_VERSION);
    expect(f.featureCount).toBe(FEATURE_COUNT);
    expect(f.labels.length).toBe(FEATURE_COUNT);
  });

  it('extracts normalized feature vector from observation', () => {
    const f = createFeaturizer();
    const obs = {
      hpRatio: 0.8, playerMaxHP: 100, recentDamageTaken: 10,
      nearEnemyCount: 5, midEnemyCount: 10, farEnemyCount: 15,
      totalEnemies: 20, nearestEnemyDist: 200,
      sectorDensity: [2, 0, 3, 1, 0, 0, 4, 1],
      sectorThreat: [10, 0, 20, 5, 0, 0, 30, 5],
      encirclement: 0.5, localThreat: 3.0, closingSpeed: 2.0,
      distToEdge: 300,
      dirDanger: [10, 5, 20, 3, 1, 2, 30, 8],
      dirReward: [0, 0, 1, 0, 0, 3, 0, 0],
      weaponReady: true, weaponCooldownRatio: 0,
      weaponRange: 200, enemiesInArc: 3,
      nearestPickupDist: 150, nearestPickupAngle: 1.5,
      level: 5, xpRatio: 0.6, wave: 3, gameTime: 120,
      clusteredSectors: 2, bestClusterDir: { x: 0.7, y: -0.7 },
      bossPresent: false, bossDist: Infinity,
      safestDirX: -0.5, safestDirY: 0.8,
    };

    const features = f.extract(obs);
    expect(features).toBeInstanceOf(Float64Array);
    expect(features.length).toBe(FEATURE_COUNT);

    // All values should be in [-1, 1]
    for (let i = 0; i < features.length; i++) {
      expect(features[i]).toBeGreaterThanOrEqual(-1);
      expect(features[i]).toBeLessThanOrEqual(1);
    }
  });

  it('extractArray returns plain array for serialization', () => {
    const f = createFeaturizer();
    const obs = { hpRatio: 0.5, playerMaxHP: 100, sectorDensity: new Array(8).fill(0), sectorThreat: new Array(8).fill(0), dirDanger: new Array(8).fill(0), dirReward: new Array(8).fill(0) };
    const arr = f.extractArray(obs);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBe(FEATURE_COUNT);
  });

  it('getSchema returns schema descriptor', () => {
    const f = createFeaturizer();
    const schema = f.getSchema();
    expect(schema.version).toBe(FEATURE_SCHEMA_VERSION);
    expect(schema.featureCount).toBe(FEATURE_COUNT);
    expect(schema.labels.length).toBe(FEATURE_COUNT);
    expect(schema.groups.length).toBeGreaterThan(0);
    expect(schema.groups[0]).toHaveProperty('name');
    expect(schema.groups[0]).toHaveProperty('offset');
    expect(schema.groups[0]).toHaveProperty('count');
  });

  it('reuses buffer across extractions', () => {
    const f = createFeaturizer();
    const obs1 = { hpRatio: 0.3, playerMaxHP: 100, sectorDensity: new Array(8).fill(0), sectorThreat: new Array(8).fill(0), dirDanger: new Array(8).fill(0), dirReward: new Array(8).fill(0) };
    const obs2 = { hpRatio: 0.9, playerMaxHP: 100, sectorDensity: new Array(8).fill(0), sectorThreat: new Array(8).fill(0), dirDanger: new Array(8).fill(0), dirReward: new Array(8).fill(0) };
    const f1 = f.extract(obs1);
    const f2 = f.extract(obs2);
    // Same buffer reference
    expect(f1).toBe(f2);
  });

  it('has feature groups covering all features', () => {
    let totalLabels = 0;
    for (const group of FEATURE_GROUPS) {
      totalLabels += group.labels.length;
    }
    expect(totalLabels).toBe(FEATURE_COUNT);
  });
});

// ── Moments ──

describe('Moment System', () => {
  it('has built-in moment definitions', () => {
    expect(MOMENT_DEFS.length).toBeGreaterThan(0);
    const defs = getMomentDefs();
    expect(defs.length).toBe(MOMENT_DEFS.length);
  });

  it('retrieves moment def by id', () => {
    const def = getMomentDef('clutch_escape');
    expect(def).toBeTruthy();
    expect(def.id).toBe('clutch_escape');
    expect(def.tags).toContain('survival');
  });

  it('creates detector with default moments', () => {
    const detector = createMomentDetector();
    expect(detector).toHaveProperty('detect');
    expect(detector).toHaveProperty('reset');
    expect(detector).toHaveProperty('notifyUpgrade');
  });

  it('detects aoe_setup_success moment', () => {
    const detector = createMomentDetector();
    const prev = { totalKills: 10, nearEnemyCount: 5 };
    const obs = { totalKills: 14, nearEnemyCount: 4 };

    // First call establishes prevObs
    detector.detect(prev, 0);
    const moments = detector.detect(obs, 1);

    const aoe = moments.find(m => m.id === 'aoe_setup_success');
    expect(aoe).toBeTruthy();
    expect(aoe.weight).toBe(3.0);
    expect(aoe.tags).toContain('combat');
  });

  it('respects moment cooldowns', () => {
    const detector = createMomentDetector();
    const prev = { totalKills: 10, nearEnemyCount: 5 };
    const obs = { totalKills: 14, nearEnemyCount: 4 };

    detector.detect(prev, 0);
    detector.detect(obs, 1); // triggers

    // Same conditions right after — should be on cooldown
    const m2 = detector.detect({ totalKills: 18, nearEnemyCount: 5 }, 2);
    expect(m2.find(m => m.id === 'aoe_setup_success')).toBeFalsy();

    // After cooldown (120 ticks)
    const m3 = detector.detect({ totalKills: 22, nearEnemyCount: 4 }, 130);
    expect(m3.find(m => m.id === 'aoe_setup_success')).toBeTruthy();
  });

  it('detects dead_upgrade_pick via notifyUpgrade', () => {
    const detector = createMomentDetector();
    const prev = { hpRatio: 0.95, totalKills: 0 };
    detector.detect(prev, 0);

    detector.notifyUpgrade({ chosen: 'heal_now', options: ['heal_now', 'damage_1'] });
    const moments = detector.detect({ hpRatio: 0.95, totalKills: 0 }, 1);
    expect(moments.find(m => m.id === 'dead_upgrade_pick')).toBeTruthy();
  });

  it('detects synergy_completed moment', () => {
    const detector = createMomentDetector();
    const prev = { acquiredUpgrades: ['focus_fire'], totalKills: 0 };
    detector.detect(prev, 0);

    detector.notifyUpgrade({ chosen: 'pierce', options: ['pierce', 'hp_1'] });
    const moments = detector.detect({ acquiredUpgrades: ['focus_fire', 'pierce'], totalKills: 0 }, 1);
    expect(moments.find(m => m.id === 'synergy_completed')).toBeTruthy();
  });

  it('supports weight overrides', () => {
    const detector = createMomentDetector({ weightOverrides: { aoe_setup_success: 99 } });
    const prev = { totalKills: 10, nearEnemyCount: 5 };
    detector.detect(prev, 0);
    const moments = detector.detect({ totalKills: 14, nearEnemyCount: 4 }, 1);
    const aoe = moments.find(m => m.id === 'aoe_setup_success');
    expect(aoe.weight).toBe(99);
  });

  it('computes moment reward', () => {
    const moments = [
      { id: 'a', weight: 3, tags: [] },
      { id: 'b', weight: -2, tags: [] },
    ];
    expect(computeMomentReward(moments)).toBe(1);
  });

  it('summarizes moments', () => {
    const moments = [
      { id: 'aoe', weight: 3, tags: ['combat', 'positive'] },
      { id: 'aoe', weight: 3, tags: ['combat', 'positive'] },
      { id: 'clutch', weight: 5, tags: ['survival', 'positive'] },
    ];
    const summary = summarizeMoments(moments);
    expect(summary.count).toBe(3);
    expect(summary.totalReward).toBe(11);
    expect(summary.byId.aoe.count).toBe(2);
    expect(summary.byTag.combat.count).toBe(2);
    expect(summary.byTag.positive.count).toBe(3);
  });

  it('registers custom moments', () => {
    const before = getMomentDefs().length;
    registerMoment({
      id: 'test_custom_moment',
      name: 'Test Custom',
      tags: ['test'],
      weight: 1,
      cooldown: 0,
      detect: () => false,
    });
    expect(getMomentDefs().length).toBe(before + 1);
    expect(getMomentDef('test_custom_moment')).toBeTruthy();
  });

  it('resets detector state', () => {
    const detector = createMomentDetector();
    detector.detect({ totalKills: 10 }, 0);
    detector.reset();
    // After reset, first detect should not produce moments
    const m = detector.detect({ totalKills: 20, nearEnemyCount: 5 }, 1);
    // No prevObs after reset, so no moments
    expect(m.length).toBe(0);
  });
});

// ── Trajectory ──

describe('Trajectory Store', () => {
  it('creates recorder with correct settings', () => {
    const rec = createTrajectoryRecorder({
      runId: 'test-run',
      detailLevel: 'sampled',
      sampleInterval: 30,
      policyId: 'test-policy',
      seed: 42,
    });
    expect(rec.runId).toBe('test-run');
    expect(rec.detailLevel).toBe('sampled');
  });

  it('records and finalizes at summary level', () => {
    const rec = createTrajectoryRecorder({
      runId: 'test-summary',
      detailLevel: 'summary',
      seed: 1,
    });

    for (let t = 0; t < 600; t++) {
      rec.record({ tick: t, features: null, action: { dx: 1, dy: 0, attack: false }, reward: 0.1 });
    }

    const traj = rec.finalize({ survivalTime: 10, survived: true, kills: 5, level: 2, wave: 1 });
    expect(traj.type).toBe('trajectory');
    expect(traj.version).toBe(1);
    expect(traj.detailLevel).toBe('summary');
    expect(traj.samples.length).toBe(0); // summary level has no samples
    expect(traj.summaries.length).toBeGreaterThan(0);
    expect(traj.cumulativeReward).toBeGreaterThan(0);
  });

  it('records samples at sampled level', () => {
    const rec = createTrajectoryRecorder({
      runId: 'test-sampled',
      detailLevel: 'sampled',
      sampleInterval: 10,
      seed: 1,
    });

    for (let t = 0; t < 100; t++) {
      rec.record({
        tick: t,
        features: [0.5, 0.3, 0.1],
        action: { dx: 1, dy: 0, attack: t % 5 === 0 },
        reward: 0.1,
      });
    }

    const traj = rec.finalize({ survivalTime: 1.67, survived: true, kills: 0 });
    expect(traj.samples.length).toBe(10); // 100 / 10 = 10
    expect(traj.samples[0].features).toEqual([0.5, 0.3, 0.1]);
    expect(traj.samples[0].action).toHaveProperty('dx');
  });

  it('records moments at moments level', () => {
    const rec = createTrajectoryRecorder({
      runId: 'test-moments',
      detailLevel: 'moments',
      seed: 1,
    });

    rec.record({
      tick: 50,
      features: null,
      action: { dx: 0, dy: 0, attack: false },
      tickMoments: [{ id: 'clutch_escape', tick: 50, weight: 5, tags: ['survival'] }],
    });

    const traj = rec.finalize({ survivalTime: 1 });
    expect(traj.moments.length).toBe(1);
    expect(traj.moments[0].id).toBe('clutch_escape');
    expect(traj.cumulativeMomentReward).toBe(5);
  });

  it('records upgrades', () => {
    const rec = createTrajectoryRecorder({ runId: 'test-upgrades', seed: 1 });
    rec.recordUpgrade({ tick: 100, level: 2, chosen: 'damage_1', options: ['damage_1', 'hp_1'] });
    const traj = rec.finalize({ survivalTime: 5 });
    expect(traj.upgrades.length).toBe(1);
    expect(traj.upgrades[0].chosen).toBe('damage_1');
  });

  it('computes trajectory stats', () => {
    const traj = {
      runId: 'stats-test',
      tickCount: 600,
      cumulativeReward: 50,
      cumulativeMomentReward: 10,
      outcome: { survivalTime: 10, kills: 20, level: 3 },
      samples: [
        { tick: 0, action: { dx: 1, dy: 0, attack: 1 } },
        { tick: 30, action: { dx: 0, dy: 0, attack: 0 } },
        { tick: 60, action: { dx: -1, dy: 1, attack: 1 } },
      ],
      moments: [
        { id: 'aoe', tick: 100 },
        { id: 'aoe', tick: 400 },
        { id: 'clutch', tick: 300 },
      ],
      summaries: [
        { tick: 300, cumulativeReward: 25, cumulativeMomentReward: 5 },
        { tick: 600, cumulativeReward: 50, cumulativeMomentReward: 10 },
      ],
    };

    const stats = trajectoryStats(traj);
    expect(stats.tickCount).toBe(600);
    expect(stats.momentCounts.aoe).toBe(2);
    expect(stats.momentCounts.clutch).toBe(1);
    expect(stats.actionDistribution.attackRate).toBeGreaterThan(0);
    expect(stats.rewardCurve.length).toBe(2);
  });
});

// ── Experiment Config ──

describe('Experiment Config', () => {
  it('creates valid config with defaults', () => {
    const config = createExperimentConfig({ name: 'test-exp' });
    expect(config.type).toBe('experiment_config');
    expect(config.version).toBe(1);
    expect(config.name).toBe('test-exp');
    expect(config.training.populationSize).toBe(10);
    expect(config.training.generations).toBe(10);
    expect(config.seedStrategy.type).toBe('sequential');
  });

  it('validates config correctly', () => {
    const good = createExperimentConfig({ name: 'valid' });
    const result = validateExperimentConfig(good);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('rejects invalid config', () => {
    const bad = createExperimentConfig({ name: '' });
    bad.name = '';
    bad.training.populationSize = 1;
    const result = validateExperimentConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects eliteCount >= populationSize', () => {
    const config = createExperimentConfig({ name: 'test', training: { populationSize: 5, eliteCount: 5 } });
    const result = validateExperimentConfig(config);
    expect(result.valid).toBe(false);
  });

  it('creates generation artifact', () => {
    const candidates = [
      { config: { name: 'a', weights: {} }, avgReward: 100, bestReward: 120, worstReward: 80, runs: [] },
      { config: { name: 'b', weights: {} }, avgReward: 50, bestReward: 60, worstReward: 40, runs: [] },
    ];

    const gen = createGenerationArtifact({
      experimentId: 'exp-1',
      generation: 0,
      candidates,
    });

    expect(gen.type).toBe('generation');
    expect(gen.candidates.length).toBe(2);
    expect(gen.candidates[0].rank).toBe(0);
    expect(gen.candidates[0].avgReward).toBe(100);
    expect(gen.stats.bestReward).toBe(100);
  });

  it('creates experiment summary', () => {
    const config = createExperimentConfig({ name: 'summary-test' });
    const gen = createGenerationArtifact({
      experimentId: config.id,
      generation: 0,
      candidates: [{ config: { name: 'winner' }, avgReward: 100, runs: [{}] }],
    });

    const summary = createExperimentSummary({
      config,
      generationHistory: [gen],
      bestCandidate: { config: { name: 'winner' }, avgReward: 100 },
    });

    expect(summary.type).toBe('experiment');
    expect(summary.result.bestReward).toBe(100);
    expect(summary.rewardCurve.length).toBe(1);
  });

  it('generates deterministic seeds', () => {
    const strategy = { type: 'sequential', startSeed: 100 };
    const s1 = getSeed(strategy, 0, 0, 0);
    const s2 = getSeed(strategy, 0, 0, 1);
    const s3 = getSeed(strategy, 1, 0, 0);
    expect(s1).toBe(100);
    expect(s2).toBe(101);
    expect(s3).toBe(1100);
  });

  it('supports fixed seed strategy', () => {
    const strategy = { type: 'fixed', seeds: [42, 99, 7] };
    expect(getSeed(strategy, 0, 0, 0)).toBe(42);
    expect(getSeed(strategy, 5, 3, 1)).toBe(99);
    expect(getSeed(strategy, 0, 0, 3)).toBe(42); // wraps
  });
});

// ── Training Backend ──

describe('Training Backend', () => {
  it('initializes population with diversity', () => {
    const base = createBotConfig({ name: 'base' });
    const pop = initializePopulation(base, 5);
    expect(pop.length).toBe(5);
    // First should be the base config
    expect(pop[0]).toBe(base);
    // Others should be different
    const weights = pop.map(c => c.weights.flee);
    const unique = new Set(weights);
    expect(unique.size).toBeGreaterThan(1);
  });

  it('selects elites and mutates', () => {
    const candidates = [
      { config: createBotConfig({ name: 'best' }), avgReward: 100 },
      { config: createBotConfig({ name: 'ok' }), avgReward: 50 },
      { config: createBotConfig({ name: 'bad' }), avgReward: 10 },
    ];

    const nextGen = selectAndMutate(candidates, {
      populationSize: 5,
      eliteCount: 2,
      mutationRate: 0.3,
      mutationScale: 0.15,
    });

    expect(nextGen.length).toBe(5);
    // Elites carry forward
    expect(nextGen[0]).toBe(candidates[0].config);
    expect(nextGen[1]).toBe(candidates[1].config);
  });

  it('evaluates population with mock run function', async () => {
    const pop = [
      createBotConfig({ name: 'a' }),
      createBotConfig({ name: 'b' }),
    ];

    const runFn = async (config, seed) => ({
      reward: config.name === 'a' ? 100 : 50,
      runId: `run-${seed}`,
      outcome: { survivalTime: 60, kills: 10, level: 3, wave: 2, totalXP: 500, damageTaken: 30 },
    });

    const results = await evaluatePopulation(pop, runFn, { seeds: [1, 2] });
    expect(results.length).toBe(2);
    // Should be sorted by avgReward descending
    expect(results[0].avgReward).toBe(100);
    expect(results[1].avgReward).toBe(50);
    expect(results[0].avgOutcome.survivalTime).toBe(60);
  });

  it('supports random injection in selection', () => {
    const candidates = [
      { config: createBotConfig({ name: 'elite' }), avgReward: 100 },
    ];
    const base = createBotConfig({ name: 'base' });

    // Force random injection by setting rate to 1.0
    const nextGen = selectAndMutate(candidates, {
      populationSize: 5,
      eliteCount: 1,
      mutationRate: 0.8,
      mutationScale: 0.3,
      randomInjectionRate: 1.0,
      baseConfig: base,
    });

    expect(nextGen.length).toBe(5);
  });
});

// ── Population Analysis ──

describe('Population Analysis', () => {
  it('computes parameter correlation', () => {
    const candidates = [
      { config: { weights: { flee: 3.0, kite: 1.0 } }, avgReward: 100 },
      { config: { weights: { flee: 2.0, kite: 2.0 } }, avgReward: 80 },
      { config: { weights: { flee: 1.0, kite: 3.0 } }, avgReward: 60 },
      { config: { weights: { flee: 0.5, kite: 3.5 } }, avgReward: 40 },
    ];

    const corrs = analyzeParameterCorrelation(candidates);
    expect(corrs.length).toBeGreaterThan(0);

    // flee should positively correlate with reward
    const fleCorr = corrs.find(c => c.key === 'flee');
    expect(fleCorr).toBeTruthy();
    expect(fleCorr.correlation).toBeGreaterThan(0.5);
    expect(fleCorr.direction).toBe('positive');

    // kite should negatively correlate
    const kiteCorr = corrs.find(c => c.key === 'kite');
    expect(kiteCorr).toBeTruthy();
    expect(kiteCorr.correlation).toBeLessThan(-0.5);
  });

  it('analyzes moment correlation', () => {
    const testRuns = [
      { reward: 100, moments: [{ id: 'aoe' }, { id: 'aoe' }, { id: 'clutch' }] },
      { reward: 80, moments: [{ id: 'aoe' }] },
      { reward: 60, moments: [{ id: 'clutch' }] },
      { reward: 40, moments: [] },
    ];

    const result = analyzeMomentCorrelation(testRuns);
    expect(result.length).toBeGreaterThan(0);
    const aoe = result.find(r => r.momentId === 'aoe');
    expect(aoe).toBeTruthy();
    expect(aoe.totalOccurrences).toBe(3);
  });

  it('analyzes upgrade correlation', () => {
    const testRuns = [
      { reward: 100, upgradePath: ['damage_1', 'pierce'] },
      { reward: 80, upgradePath: ['damage_1', 'hp_1'] },
      { reward: 60, upgradePath: ['hp_1', 'regen_1'] },
    ];

    const result = analyzeUpgradeCorrelation(testRuns);
    expect(result.upgradeRewardMap.damage_1).toBeTruthy();
    expect(result.upgradeRewardMap.damage_1.avgReward).toBe(90);
    expect(result.bestPaths.length).toBeGreaterThan(0);
  });

  it('analyzes candidate dominance', () => {
    const candidates = [
      {
        config: { name: 'dominant' },
        avgReward: 100,
        runs: [{ seed: 1, reward: 100 }, { seed: 2, reward: 100 }],
      },
      {
        config: { name: 'weak' },
        avgReward: 30,
        runs: [{ seed: 1, reward: 30 }, { seed: 2, reward: 30 }],
      },
    ];

    const result = analyzeCandidateDominance(candidates);
    expect(result.length).toBe(2);
    expect(result[0].name).toBe('dominant');
    expect(result[0].dominanceScore).toBe(1);
    expect(result[0].seedWins).toBe(2);
  });

  it('analyzes convergence from generation history', () => {
    const gens = [
      { stats: { bestReward: 50, medianReward: 30, diversity: 0.5 } },
      { stats: { bestReward: 60, medianReward: 40, diversity: 0.4 } },
      { stats: { bestReward: 70, medianReward: 50, diversity: 0.3 } },
      { stats: { bestReward: 80, medianReward: 60, diversity: 0.2 } },
    ];

    const result = analyzeConvergence(gens);
    expect(result.trend).toBe('improving');
    expect(result.bestSlope).toBeGreaterThan(0);
    expect(result.bestRewards.length).toBe(4);
  });

  it('detects stagnation', () => {
    const gens = [
      { stats: { bestReward: 50, medianReward: 30, diversity: 0.3 } },
      { stats: { bestReward: 50.5, medianReward: 30.1, diversity: 0.29 } },
      { stats: { bestReward: 50.2, medianReward: 29.8, diversity: 0.3 } },
      { stats: { bestReward: 50.1, medianReward: 30.2, diversity: 0.28 } },
    ];

    const result = analyzeConvergence(gens);
    expect(result.trend).toBe('stagnating');
  });

  it('runs full population analysis', () => {
    const gen = createGenerationArtifact({
      experimentId: 'test',
      generation: 0,
      candidates: [
        { config: { name: 'a', weights: { flee: 2 } }, avgReward: 100, runs: [] },
        { config: { name: 'b', weights: { flee: 1 } }, avgReward: 50, runs: [] },
        { config: { name: 'c', weights: { flee: 0.5 } }, avgReward: 30, runs: [] },
      ],
    });

    const result = fullPopulationAnalysis({ generations: [gen], allRuns: [] });
    expect(result).toHaveProperty('parameterCorrelation');
    expect(result).toHaveProperty('convergence');
    expect(result.generationCount).toBe(1);
  });
});

// ── Replay Enhancements ──

describe('Replay Enhancements', () => {
  it('compares parent and child runs', () => {
    const parent = {
      runId: 'parent-1', generation: 0,
      botConfig: { weights: { flee: 1.0, kite: 1.5, upgradeWeights: { damage: 1.0 } } },
      summary: { survivalTime: 60, kills: 20, level: 5, wave: 3, score: 100 },
      reward: { total: 80, components: [{ name: 'survival', contribution: 60 }] },
    };
    const child = {
      runId: 'child-1', generation: 1,
      botConfig: { weights: { flee: 1.5, kite: 1.3, upgradeWeights: { damage: 1.2 } } },
      summary: { survivalTime: 80, kills: 25, level: 6, wave: 4, score: 120 },
      reward: { total: 100, components: [{ name: 'survival', contribution: 80 }] },
    };

    const result = compareParentChild(parent, child);
    expect(result.configDiff.flee).toBeTruthy();
    expect(result.configDiff.flee.delta).toBeCloseTo(0.5);
    expect(result.configDiff['upgrade.damage']).toBeTruthy();
    expect(result.generation.parent).toBe(0);
    expect(result.generation.child).toBe(1);
  });

  it('compares generation winners', () => {
    const gens = [
      { generation: 0, candidates: [{ name: 'g0-best', avgReward: 50, config: {} }] },
      { generation: 1, candidates: [{ name: 'g1-best', avgReward: 70, config: {} }] },
      { generation: 2, candidates: [{ name: 'g2-best', avgReward: 65, config: {} }] },
    ];

    const result = compareGenerationWinners(gens);
    expect(result.winners.length).toBe(3);
    expect(result.improvements.length).toBe(2);
    expect(result.improvements[0].improved).toBe(true);
    expect(result.improvements[0].rewardDelta).toBe(20);
    expect(result.improvements[1].improved).toBe(false);
    expect(result.improvements[1].rewardDelta).toBe(-5);
  });
});

// ── Rewards Enhancement ──

describe('Rewards with Moments', () => {
  it('includes moment component in reward breakdown', () => {
    const result = { survivalTime: 60, kills: 20, level: 5, wave: 3 };
    const moments = [
      { id: 'aoe', weight: 3 },
      { id: 'clutch', weight: 5 },
    ];

    const breakdown = computeRewardBreakdown(result, undefined, { moments });
    const momentComp = breakdown.components.find(c => c.name === 'moments');
    expect(momentComp).toBeTruthy();
    expect(momentComp.raw).toBe(8);
    expect(momentComp.contribution).toBe(8);
  });

  it('applies moment reward scale', () => {
    const result = { survivalTime: 30 };
    const moments = [{ id: 'test', weight: 10 }];

    const breakdown = computeRewardBreakdown(result, undefined, {
      moments,
      momentRewardScale: 0.5,
    });
    const momentComp = breakdown.components.find(c => c.name === 'moments');
    expect(momentComp.raw).toBe(5);
  });

  it('defaults to zero moment reward without moments', () => {
    const result = { survivalTime: 30 };
    const breakdown = computeRewardBreakdown(result);
    const momentComp = breakdown.components.find(c => c.name === 'moments');
    expect(momentComp).toBeTruthy();
    expect(momentComp.raw).toBe(0);
  });
});
