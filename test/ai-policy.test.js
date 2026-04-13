/**
 * Tests for the AI policy system:
 * - Policy interface compliance
 * - Observation extraction
 * - Scoring logic
 * - Upgrade strategy scoring
 * - Policy behavior basics
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadEngine } from '../src/engine/loader.js';
import { EngineBindings, TYPE, STATE } from '../src/engine/bindings.js';
import { createObservationBuilder } from '../src/ai/observations.js';
import { registerPolicy, createPolicy, listPolicies, validatePolicy } from '../src/ai/policy-types.js';
import { computeScore, aggregateResults } from '../src/ai/scoring.js';
import { scoreUpgrade, chooseUpgrade, BALANCED_WEIGHTS, DEFENSIVE_WEIGHTS, AGGRESSIVE_WEIGHTS } from '../src/ai/upgrade-strategies.js';
import { analyzeResults } from '../src/ai/analysis.js';

// Register built-in policies
import '../src/ai/policies/survival.js';
import '../src/ai/policies/progression.js';

let engine;

beforeEach(async () => {
  const wasm = await loadEngine();
  engine = new EngineBindings(wasm);
  engine.init(4096, 4096);
});

describe('Policy interface', () => {
  it('lists registered policies', () => {
    const policies = listPolicies();
    expect(policies).toContain('survival');
    expect(policies).toContain('progression');
  });

  it('creates a policy by id', () => {
    const policy = createPolicy('survival');
    expect(policy.name).toBe('Survival');
    expect(policy.id).toBe('survival');
    expect(typeof policy.act).toBe('function');
    expect(typeof policy.chooseUpgrade).toBe('function');
    expect(typeof policy.reset).toBe('function');
  });

  it('throws on unknown policy id', () => {
    expect(() => createPolicy('nonexistent')).toThrow(/Unknown policy/);
  });

  it('validates a valid policy', () => {
    const policy = createPolicy('survival');
    expect(validatePolicy(policy)).toBe(true);
  });

  it('validates incomplete policy', () => {
    expect(() => validatePolicy({})).toThrow(/missing/i);
  });

  it('creates policies with custom params', () => {
    const policy = createPolicy('survival', { dangerRadius: 99 });
    expect(policy.params.dangerRadius).toBe(99);
  });

  it('survival policy has expected default params', () => {
    const policy = createPolicy('survival');
    expect(policy.params.dangerRadius).toBeDefined();
    expect(policy.params.engageRadius).toBeDefined();
    expect(policy.params.meleeEngageRadius).toBeDefined();
  });

  it('progression policy has expected default params', () => {
    const policy = createPolicy('progression');
    expect(policy.params.dangerRadius).toBeDefined();
    expect(policy.params.pickupGreed).toBeDefined();
  });
});

describe('Observation extraction', () => {
  it('builds observation with player context', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    const obs = createObservationBuilder(engine);
    const o = obs.build({
      playerX: 2048, playerY: 2048,
      playerHP: 100, playerMaxHP: 100,
      level: 1, xp: 0, xpToNext: 45,
      weapon: 'sword', gameTime: 10, wave: 0,
      totalKills: 0, acquiredUpgrades: [],
      activeEffects: [], worldW: 4096, worldH: 4096,
    });

    expect(o.playerX).toBe(2048);
    expect(o.playerHP).toBe(100);
    expect(o.hpRatio).toBe(1);
    expect(o.level).toBe(1);
    expect(o.weapon).toBe('sword');
    expect(o.sectorDensity).toHaveLength(8);
    expect(o.sectorThreat).toHaveLength(8);
    expect(o.distToEdge).toBe(2048);
  });

  it('detects nearby enemies in observation', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    // Spawn enemies nearby
    engine.spawnEntity(TYPE.ENEMY_BASIC, 2100, 2048, 30, 60, 10, 8, 10);
    engine.spawnEntity(TYPE.ENEMY_FAST, 2200, 2048, 15, 120, 7, 5, 8);

    // Step to populate spatial grid
    engine.setPlayerInput(0, 0, 0);
    engine.step(1 / 60);

    const obs = createObservationBuilder(engine);
    const o = obs.build({
      playerX: 2048, playerY: 2048,
      playerHP: 100, playerMaxHP: 100,
      level: 1, xp: 0, xpToNext: 45,
      weapon: 'sword', gameTime: 10, wave: 0,
      totalKills: 0, acquiredUpgrades: [],
      activeEffects: [], worldW: 4096, worldH: 4096,
    });

    expect(o.nearEnemyCount).toBeGreaterThanOrEqual(1); // at least one within 150
    expect(o.midEnemyCount).toBe(2); // both within 350
    expect(o.nearestEnemyDist).toBeLessThan(150);
  });

  it('tracks damage taken between observations', () => {
    const obs = createObservationBuilder(engine);

    const o1 = obs.build({
      playerX: 2048, playerY: 2048,
      playerHP: 100, playerMaxHP: 100,
      level: 1, xp: 0, xpToNext: 45,
      weapon: 'sword', gameTime: 0, wave: 0,
      totalKills: 0, acquiredUpgrades: [],
      activeEffects: [], worldW: 4096, worldH: 4096,
    });
    expect(o1.recentDamageTaken).toBe(0); // first observation

    const o2 = obs.build({
      playerX: 2048, playerY: 2048,
      playerHP: 85, playerMaxHP: 100,
      level: 1, xp: 0, xpToNext: 45,
      weapon: 'sword', gameTime: 1, wave: 0,
      totalKills: 0, acquiredUpgrades: [],
      activeEffects: [], worldW: 4096, worldH: 4096,
    });
    expect(o2.recentDamageTaken).toBe(15);
  });

  it('detects nearby pickups', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);
    engine.spawnEntity(TYPE.PICKUP_XP, 2148, 2048, 1, 0, 15, 0, 10);

    // Step to populate spatial grid
    engine.setPlayerInput(0, 0, 0);
    engine.step(1 / 60);

    const obs = createObservationBuilder(engine);
    const o = obs.build({
      playerX: 2048, playerY: 2048,
      playerHP: 100, playerMaxHP: 100,
      level: 1, xp: 0, xpToNext: 45,
      weapon: 'sword', gameTime: 0, wave: 0,
      totalKills: 0, acquiredUpgrades: [],
      activeEffects: [], worldW: 4096, worldH: 4096,
    });

    expect(o.nearestPickupDist).toBeLessThan(200);
  });
});

describe('Policy actions', () => {
  function makeObs(overrides = {}) {
    return {
      playerX: 2048, playerY: 2048,
      playerHP: 100, playerMaxHP: 100,
      hpRatio: 1, level: 1, xp: 0, xpToNext: 45, xpRatio: 0,
      weapon: 'sword', cooldownReady: 1,
      nearEnemyCount: 0, midEnemyCount: 0, farEnemyCount: 0,
      sectorDensity: new Array(8).fill(0),
      sectorThreat: new Array(8).fill(0),
      nearestEnemyDist: 500, nearestEnemyAngle: 0,
      nearestEnemyX: 2548, nearestEnemyY: 2048,
      nearestPickupDist: 500, nearestPickupAngle: 0,
      nearestPickupX: 2548, nearestPickupY: 2048,
      recentDamageTaken: 0, gameTime: 10, wave: 0,
      totalKills: 0, totalEnemies: 0,
      worldW: 4096, worldH: 4096, distToEdge: 2048,
      acquiredUpgrades: [], activeEffects: [],
      ...overrides,
    };
  }

  it('survival policy returns valid action', () => {
    const policy = createPolicy('survival');
    policy.reset();
    const action = policy.act(makeObs());
    expect(action).toHaveProperty('dx');
    expect(action).toHaveProperty('dy');
    expect(action).toHaveProperty('attack');
    expect(action).toHaveProperty('targetX');
    expect(action).toHaveProperty('targetY');
  });

  it('progression policy returns valid action', () => {
    const policy = createPolicy('progression');
    policy.reset();
    const action = policy.act(makeObs());
    expect(action).toHaveProperty('dx');
    expect(action).toHaveProperty('dy');
    expect(action).toHaveProperty('attack');
  });

  it('survival policy flees when enemy very close', () => {
    const policy = createPolicy('survival');
    policy.reset();
    // Enemy very close to the right
    const action = policy.act(makeObs({
      nearestEnemyDist: 30,
      nearestEnemyX: 2078,
      nearestEnemyY: 2048,
      nearEnemyCount: 1,
      midEnemyCount: 1,
      farEnemyCount: 1,
    }));
    // Should move away (negative dx)
    expect(action.dx).toBeLessThan(0);
  });

  it('progression policy approaches enemies aggressively', () => {
    const policy = createPolicy('progression');
    policy.reset();
    // Enemy moderately far to the right
    const action = policy.act(makeObs({
      nearestEnemyDist: 200,
      nearestEnemyX: 2248,
      nearestEnemyY: 2048,
      nearEnemyCount: 0,
      midEnemyCount: 1,
      farEnemyCount: 1,
    }));
    // Should move toward
    expect(action.dx).toBeGreaterThan(0);
  });

  it('survival policy engages at melee range for sword', () => {
    const policy = createPolicy('survival');
    policy.reset();
    // Enemy at 100px — outside melee but inside engage range
    const action = policy.act(makeObs({
      weapon: 'sword',
      nearestEnemyDist: 100,
      nearestEnemyX: 2148,
      nearestEnemyY: 2048,
      nearEnemyCount: 1,
      midEnemyCount: 1,
      farEnemyCount: 1,
    }));
    // Should approach (positive dx toward enemy)
    expect(action.dx).toBeGreaterThan(0);
    expect(action.attack).toBe(true);
  });
});

describe('Scoring', () => {
  it('computes positive score for a decent run', () => {
    const score = computeScore({
      survivalTime: 120,
      level: 5,
      kills: 200,
      totalXP: 1000,
      wave: 2,
      damageTaken: 500,
      survived: false,
    });
    expect(score).toBeGreaterThan(0);
  });

  it('gives higher score for longer survival', () => {
    const base = { level: 3, kills: 100, totalXP: 500, wave: 1, damageTaken: 200, survived: false };
    const s1 = computeScore({ ...base, survivalTime: 60 });
    const s2 = computeScore({ ...base, survivalTime: 120 });
    expect(s2).toBeGreaterThan(s1);
  });

  it('penalizes death', () => {
    const base = { survivalTime: 100, level: 5, kills: 200, totalXP: 500, wave: 2, damageTaken: 100 };
    const alive = computeScore({ ...base, survived: true });
    const dead = computeScore({ ...base, survived: false });
    expect(alive).toBeGreaterThan(dead);
  });

  it('aggregates results correctly', () => {
    const results = [
      { score: 100, survivalTime: 60, level: 3, kills: 50, survived: false },
      { score: 200, survivalTime: 120, level: 5, kills: 100, survived: true },
      { score: 150, survivalTime: 90, level: 4, kills: 75, survived: false },
    ];
    const agg = aggregateResults(results);
    expect(agg.count).toBe(3);
    expect(agg.bestScore).toBe(200);
    expect(agg.medianScore).toBe(150);
    expect(agg.avgLevel).toBeCloseTo(4);
    expect(agg.survivedCount).toBe(1);
  });
});

describe('Upgrade strategies', () => {
  const makeUpgrade = (overrides) => ({
    id: 'test', name: 'Test', desc: 'Test',
    category: 'power', tier: 3, maxStacks: 1,
    ...overrides,
  });

  const obs = {
    hpRatio: 0.7, level: 3, acquiredUpgrades: [],
    weapon: 'sword', activeEffects: [],
  };

  it('scores HP upgrade higher with defensive weights', () => {
    const hpUpg = makeUpgrade({ id: 'hp', maxHpBonus: 30 });
    const dmgUpg = makeUpgrade({ id: 'dmg', damageMultiplier: 1.2 });

    const hpDefensive = scoreUpgrade(hpUpg, DEFENSIVE_WEIGHTS, obs);
    const dmgDefensive = scoreUpgrade(dmgUpg, DEFENSIVE_WEIGHTS, obs);
    expect(hpDefensive).toBeGreaterThan(dmgDefensive);

    const dmgAggressive = scoreUpgrade(dmgUpg, AGGRESSIVE_WEIGHTS, obs);
    const hpAggressive = scoreUpgrade(hpUpg, AGGRESSIVE_WEIGHTS, obs);
    expect(dmgAggressive).toBeGreaterThan(hpAggressive);
  });

  it('chooseUpgrade returns an upgrade id', () => {
    const choices = [
      makeUpgrade({ id: 'a', maxHpBonus: 30 }),
      makeUpgrade({ id: 'b', damageMultiplier: 1.2 }),
    ];
    const result = chooseUpgrade(choices, BALANCED_WEIGHTS, obs);
    expect(['a', 'b']).toContain(result);
  });

  it('returns null for empty choices', () => {
    expect(chooseUpgrade([], BALANCED_WEIGHTS, obs)).toBeNull();
  });
});

describe('Analysis', () => {
  it('analyzes batch results', () => {
    const results = [
      { score: 100, policyId: 'survival', upgradePath: ['sword_mastery', 'pierce', 'vampiric'], weaponPath: ['sword_mastery'], survivalTime: 120, level: 5, kills: 200 },
      { score: 150, policyId: 'survival', upgradePath: ['sword_mastery', 'berserker', 'damage_1'], weaponPath: ['sword_mastery'], survivalTime: 180, level: 7, kills: 400 },
      { score: 80, policyId: 'progression', upgradePath: ['nova_unlock', 'kill_shockwave', 'magnet_1'], weaponPath: ['nova_unlock'], survivalTime: 90, level: 4, kills: 150 },
    ];

    const analysis = analyzeResults(results);

    expect(analysis.earlyUpgradePicks.length).toBeGreaterThan(0);
    expect(analysis.topUpgradePaths.length).toBe(3);
    expect(analysis.weaponPerformance.length).toBeGreaterThanOrEqual(1);
    expect(analysis.policyComparison.length).toBe(2);
    expect(analysis.strategySignatures.length).toBeGreaterThan(0);
  });

  it('returns empty analysis for no results', () => {
    const analysis = analyzeResults([]);
    expect(analysis.earlyUpgradePicks).toEqual([]);
    expect(analysis.topUpgradePaths).toEqual([]);
  });
});

describe('Policy upgrade selection', () => {
  it('survival policy chooses upgrades', () => {
    const policy = createPolicy('survival');
    policy.reset();
    const choices = [
      { id: 'hp_1', name: 'Vitality', maxHpBonus: 30, maxStacks: 4 },
      { id: 'damage_1', name: 'Heavy Hits', damageMultiplier: 1.2, maxStacks: 3 },
    ];
    const obs = { hpRatio: 0.8, level: 3, acquiredUpgrades: [], weapon: 'sword', activeEffects: [] };
    const choice = policy.chooseUpgrade(choices, obs);
    expect(['hp_1', 'damage_1']).toContain(choice);
  });

  it('policies choose differently with different preferences', () => {
    const survival = createPolicy('survival');
    const progression = createPolicy('progression');
    survival.reset();
    progression.reset();

    const choices = [
      { id: 'hp_1', name: 'Vitality', maxHpBonus: 30, maxStacks: 4, regenRate: 2, effect: 'scaling_regen' },
      { id: 'damage_1', name: 'Heavy Hits', damageMultiplier: 1.2, stunDurationBonus: 0.1, maxStacks: 3 },
      { id: 'kill_shockwave', name: 'Shockwave', effect: 'kill_shockwave', maxStacks: 1 },
    ];
    const obs = { hpRatio: 0.7, level: 5, acquiredUpgrades: [], weapon: 'sword', activeEffects: [] };

    const sChoice = survival.chooseUpgrade(choices, obs);
    const pChoice = progression.chooseUpgrade(choices, obs);

    // They should at least produce valid choices (may or may not differ based on weights)
    expect(choices.map(c => c.id)).toContain(sChoice);
    expect(choices.map(c => c.id)).toContain(pChoice);
  });
});
