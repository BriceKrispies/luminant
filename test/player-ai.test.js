import { describe, it, expect, beforeEach } from 'vitest';
import { loadEngine } from '../src/engine/loader.js';
import { EngineBindings, TYPE, STATE } from '../src/engine/bindings.js';
import { createObservationBuilder } from '../src/ai/observations.js';
import { createSensors } from '../src/systems/player-ai/sensors.js';
import { createUtilityScorer, INTENTIONS } from '../src/systems/player-ai/utility-scorer.js';
import { createMovementPlanner } from '../src/systems/player-ai/movement-planner.js';
import { createUpgradeStrategy } from '../src/systems/player-ai/upgrade-strategy.js';
import { createPolicy, listPolicies } from '../src/ai/policy-types.js';

// Register policies
import '../src/systems/player-ai/policies/coward.js';
import '../src/systems/player-ai/policies/kiter.js';
import '../src/systems/player-ai/policies/brawler.js';
import '../src/systems/player-ai/policies/farmer.js';

function makeObs(overrides = {}) {
  return {
    playerX: 2048, playerY: 2048,
    playerHP: 100, playerMaxHP: 100,
    hpRatio: 1, level: 1, xp: 0, xpToNext: 45, xpRatio: 0,
    weapon: 'sword', weaponReady: true, weaponCooldownRatio: 0,
    weaponRange: 75, enemiesInArc: 0,
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
    safestDirX: -1, safestDirY: 0,
    acquiredUpgrades: [], activeEffects: [],
    bossPresent: false, bossX: 0, bossY: 0, bossDist: Infinity,
    ...overrides,
  };
}

describe('Sensors', () => {
  it('enriches observation with derived signals', () => {
    const sensors = createSensors();
    const obs = makeObs({
      sectorDensity: [3, 0, 2, 0, 1, 0, 0, 0],
      sectorThreat: [100, 0, 50, 0, 20, 0, 0, 0],
    });
    const data = sensors.sense(obs);

    expect(data.encirclement).toBeCloseTo(3 / 8);
    expect(data.localThreat).toBeGreaterThan(0);
    expect(data.dirDanger).toHaveLength(8);
    expect(data.dirReward).toHaveLength(8);
    expect(data.preferredRange).toBeGreaterThan(0);
    expect(data.clusteredSectors).toBe(2);
    // Should still have all original obs fields
    expect(data.playerX).toBe(2048);
    expect(data.weapon).toBe('sword');
  });

  it('computes higher encirclement when more sectors occupied', () => {
    const sensors = createSensors();
    const low = sensors.sense(makeObs({
      sectorDensity: [1, 0, 0, 0, 0, 0, 0, 0],
    }));
    const high = sensors.sense(makeObs({
      sectorDensity: [1, 1, 1, 1, 1, 1, 1, 1],
    }));
    expect(high.encirclement).toBeGreaterThan(low.encirclement);
  });

  it('adjusts preferred range by weapon type', () => {
    const sensors = createSensors();
    const sword = sensors.sense(makeObs({ weapon: 'sword' }));
    const shotgun = sensors.sense(makeObs({ weapon: 'shotgun' }));
    expect(shotgun.preferredRange).toBeGreaterThan(sword.preferredRange);
  });
});

describe('Utility scorer', () => {
  it('scores all intentions', () => {
    const scorer = createUtilityScorer();
    const sensors = createSensors();
    const data = sensors.sense(makeObs());
    const weights = {
      flee: 1, kite: 1, hold_range: 1, reposition_for_shot: 1,
      collapse_on_cluster: 1, collect_xp: 1, boss_focus: 1,
      maintain_pressure: 1, hold_ground: 1,
      dangerWeight: 1, rewardWeight: 1,
    };
    const result = scorer.score(data, weights);

    for (const intent of INTENTIONS) {
      expect(result.intentionScores).toHaveProperty(intent);
      expect(typeof result.intentionScores[intent]).toBe('number');
    }
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.bestCandidate).toBeDefined();
  });

  it('flee scores high when low HP and surrounded', () => {
    const scorer = createUtilityScorer();
    const sensors = createSensors();
    const safeData = sensors.sense(makeObs());
    const dangerData = sensors.sense(makeObs({
      playerHP: 20, playerMaxHP: 100, hpRatio: 0.2,
      nearEnemyCount: 6, nearestEnemyDist: 50,
      sectorDensity: [2, 1, 2, 1, 2, 1, 2, 1],
      sectorThreat: [100, 50, 100, 50, 100, 50, 100, 50],
      recentDamageTaken: 15,
    }));

    const weights = {
      flee: 1, kite: 1, hold_range: 1, reposition_for_shot: 1,
      collapse_on_cluster: 1, collect_xp: 1, boss_focus: 1,
      maintain_pressure: 1, hold_ground: 1,
      dangerWeight: 1, rewardWeight: 1,
      retreatThreshold: 0.3,
    };

    const safe = scorer.score(safeData, weights);
    const danger = scorer.score(dangerData, weights);

    expect(danger.intentionScores.flee).toBeGreaterThan(safe.intentionScores.flee);
  });
});

describe('Movement planner', () => {
  it('does not jitter between opposite directions in stable scenarios', () => {
    const planner = createMovementPlanner({ commitmentTime: 10, smoothingRate: 0.3 });
    const scorer = createUtilityScorer();
    const sensors = createSensors();
    const weights = {
      flee: 1, kite: 2, hold_range: 1, reposition_for_shot: 1,
      collapse_on_cluster: 1, collect_xp: 1, boss_focus: 1,
      maintain_pressure: 1, hold_ground: 1,
      dangerWeight: 1, rewardWeight: 1,
    };

    const obs = makeObs({
      nearestEnemyDist: 100,
      nearestEnemyX: 2148, nearestEnemyY: 2048,
      nearEnemyCount: 2, midEnemyCount: 2, farEnemyCount: 2,
      sectorDensity: [0, 0, 0, 0, 2, 0, 0, 0],
      sectorThreat: [0, 0, 0, 0, 50, 0, 0, 0],
    });

    const actions = [];
    for (let i = 0; i < 30; i++) {
      const data = sensors.sense(obs);
      const scored = scorer.score(data, weights);
      const action = planner.plan(scored, data);
      actions.push(action);
    }

    // Check that direction doesn't flip-flop: consecutive dx/dy should not
    // alternate signs rapidly
    let signFlips = 0;
    for (let i = 1; i < actions.length; i++) {
      if (Math.sign(actions[i].dx) !== Math.sign(actions[i - 1].dx) &&
          Math.abs(actions[i].dx) > 0.1 && Math.abs(actions[i - 1].dx) > 0.1) {
        signFlips++;
      }
    }
    expect(signFlips).toBeLessThan(5);
  });
});

describe('Utility policies', () => {
  it('registers all four utility policies', () => {
    const policies = listPolicies();
    expect(policies).toContain('coward');
    expect(policies).toContain('kiter');
    expect(policies).toContain('brawler');
    expect(policies).toContain('farmer');
  });

  it('each policy returns valid actions', () => {
    for (const id of ['coward', 'kiter', 'brawler', 'farmer']) {
      const policy = createPolicy(id);
      policy.reset();
      const action = policy.act(makeObs());
      expect(action).toHaveProperty('dx');
      expect(action).toHaveProperty('dy');
      expect(action).toHaveProperty('attack');
      expect(action).toHaveProperty('targetX');
      expect(action).toHaveProperty('targetY');
    }
  });

  it('AI flees when low HP and danger is high', () => {
    const coward = createPolicy('coward');
    coward.reset();

    // Enemies concentrated to the east (sector 4), safest escape is west
    const dangerObs = makeObs({
      playerHP: 15, playerMaxHP: 100, hpRatio: 0.15,
      nearEnemyCount: 5,
      nearestEnemyDist: 40,
      nearestEnemyX: 2088, nearestEnemyY: 2048,
      sectorDensity: [0, 0, 0, 1, 4, 1, 0, 0],
      sectorThreat: [0, 0, 0, 30, 200, 30, 0, 0],
      safestDirX: -1, safestDirY: 0,
      recentDamageTaken: 10,
    });

    let lastAction;
    for (let i = 0; i < 10; i++) {
      lastAction = coward.act(dangerObs);
    }

    expect(lastAction._intention).toBe('flee');
    expect(lastAction.dx).toBeLessThan(0);
  });

  it('AI prefers XP collection when safe and pickup nearby', () => {
    const farmer = createPolicy('farmer');
    farmer.reset();

    const safeXPObs = makeObs({
      nearEnemyCount: 0,
      nearestEnemyDist: 500,
      nearestPickupDist: 80,
      nearestPickupX: 2128, nearestPickupY: 2048,
      nearestPickupAngle: 0,
    });

    let lastAction;
    for (let i = 0; i < 10; i++) {
      lastAction = farmer.act(safeXPObs);
    }

    // Farmer should prioritize collecting XP — moving toward pickup (positive dx)
    expect(lastAction.dx).toBeGreaterThan(0);
  });

  it('kiter maintains better spacing than brawler', () => {
    const kiter = createPolicy('kiter');
    const brawler = createPolicy('brawler');
    kiter.reset();
    brawler.reset();

    // Enemy very close from the right — inside preferred sword range
    const obs = makeObs({
      nearestEnemyDist: 30,
      nearestEnemyX: 2078, nearestEnemyY: 2048,
      nearEnemyCount: 3, midEnemyCount: 3, farEnemyCount: 3,
      enemiesInArc: 2,
      sectorDensity: [0, 0, 0, 0, 3, 0, 0, 0],
      sectorThreat: [0, 0, 0, 0, 120, 0, 0, 0],
      safestDirX: -1, safestDirY: 0,
    });

    let kiterAction, brawlerAction;
    for (let i = 0; i < 25; i++) {
      kiterAction = kiter.act(obs);
      brawlerAction = brawler.act(obs);
    }

    // Kiter should move further from enemy (more negative dx) than brawler
    expect(kiterAction.dx).toBeLessThan(brawlerAction.dx);
  });

  it('AI changes behavior when weapon archetype changes', () => {
    const kiter = createPolicy('kiter');
    kiter.reset();

    const swordObs = makeObs({
      weapon: 'sword', weaponRange: 75,
      nearestEnemyDist: 100,
      nearestEnemyX: 2148, nearestEnemyY: 2048,
      nearEnemyCount: 1, midEnemyCount: 1, farEnemyCount: 1,
      sectorDensity: [0, 0, 0, 0, 1, 0, 0, 0],
      sectorThreat: [0, 0, 0, 0, 30, 0, 0, 0],
    });

    let swordAction;
    for (let i = 0; i < 10; i++) {
      swordAction = kiter.act(swordObs);
    }
    const swordPreferred = swordAction._preferredRange;

    kiter.reset();
    const shotgunObs = makeObs({
      weapon: 'shotgun', weaponRange: 240,
      nearestEnemyDist: 100,
      nearestEnemyX: 2148, nearestEnemyY: 2048,
      nearEnemyCount: 1, midEnemyCount: 1, farEnemyCount: 1,
      sectorDensity: [0, 0, 0, 0, 1, 0, 0, 0],
      sectorThreat: [0, 0, 0, 0, 30, 0, 0, 0],
    });

    let shotgunAction;
    for (let i = 0; i < 10; i++) {
      shotgunAction = kiter.act(shotgunObs);
    }
    const shotgunPreferred = shotgunAction._preferredRange;

    // Shotgun should prefer longer range than sword
    expect(shotgunPreferred).toBeGreaterThan(swordPreferred);
  });
});

describe('Upgrade strategy', () => {
  it('chooses coherent upgrades based on policy', () => {
    const defensiveStrategy = createUpgradeStrategy({
      survivalBias: 0.9,
      upgradeWeights: { survivability: 2.5, damage: 0.3, aoe: 0.4, speed: 1, utility: 0.5, scaling: 0.5 },
    });
    const aggressiveStrategy = createUpgradeStrategy({
      clusterPreference: 0.8,
      upgradeWeights: { survivability: 0.3, damage: 2.0, aoe: 2.0, speed: 0.5, utility: 0.5, scaling: 1.5 },
    });

    const choices = [
      { id: 'hp_1', name: 'Vitality', maxHpBonus: 30, maxStacks: 4 },
      { id: 'damage_1', name: 'Heavy Hits', damageMultiplier: 1.2, stunDurationBonus: 0.1, maxStacks: 3 },
      { id: 'kill_shockwave', name: 'Shockwave', effect: 'kill_shockwave', maxStacks: 1 },
    ];
    const obs = { hpRatio: 0.7, level: 3, acquiredUpgrades: [], weapon: 'sword', activeEffects: [] };

    const defensive = defensiveStrategy.choose(choices, obs);
    const aggressive = aggressiveStrategy.choose(choices, obs);

    // Defensive should prefer HP; aggressive should prefer damage/aoe
    expect(defensive).toBe('hp_1');
    expect(['damage_1', 'kill_shockwave']).toContain(aggressive);
  });

  it('policy chooseUpgrade delegates to strategy', () => {
    const coward = createPolicy('coward');
    coward.reset();

    const choices = [
      { id: 'hp_1', name: 'Vitality', maxHpBonus: 30, maxStacks: 4 },
      { id: 'damage_1', name: 'Heavy Hits', damageMultiplier: 1.2, maxStacks: 3 },
    ];
    const obs = makeObs({ hpRatio: 0.5 });

    const choice = coward.chooseUpgrade(choices, obs);
    expect(['hp_1', 'damage_1']).toContain(choice);
    // Coward should prefer survivability
    expect(choice).toBe('hp_1');
  });
});

describe('Integration with engine', () => {
  let engine;

  beforeEach(async () => {
    const wasm = await loadEngine();
    engine = new EngineBindings(wasm);
    engine.init(4096, 4096);
  });

  it('utility policies work with real observations', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);
    engine.spawnEntity(TYPE.ENEMY_BASIC, 2100, 2048, 30, 60, 10, 8, 10);

    engine.setPlayerInput(0, 0, 0);
    engine.step(1 / 60);

    const obsBuilder = createObservationBuilder(engine);
    const obs = obsBuilder.build({
      playerX: 2048, playerY: 2048,
      playerHP: 100, playerMaxHP: 100,
      level: 1, xp: 0, xpToNext: 45,
      weapon: 'sword', weaponReady: true, weaponCooldownRatio: 0,
      gameTime: 10, wave: 0,
      totalKills: 0, acquiredUpgrades: [],
      activeEffects: [], worldW: 4096, worldH: 4096,
    });

    for (const id of ['coward', 'kiter', 'brawler', 'farmer']) {
      const policy = createPolicy(id);
      policy.reset();
      const action = policy.act(obs);
      expect(typeof action.dx).toBe('number');
      expect(typeof action.dy).toBe('number');
      expect(typeof action.attack).toBe('boolean');
      expect(Number.isFinite(action.dx)).toBe(true);
      expect(Number.isFinite(action.dy)).toBe(true);
    }
  });
});
