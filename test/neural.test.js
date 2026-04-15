import { describe, it, expect } from 'vitest';
import { FeedforwardNetwork } from '../src/ai/neural/feedforward.js';
import { INPUT_SIZE, encodeObservation } from '../src/ai/neural/encode.js';

describe('FeedforwardNetwork', () => {
  it('reports correct weight count for default topology', () => {
    const net = new FeedforwardNetwork([53, 32, 16, 4]);
    // 53*32 + 32 + 32*16 + 16 + 16*4 + 4 = 1696 + 32 + 512 + 16 + 64 + 4 = 2324
    expect(net.weightCount).toBe(2324);
  });

  it('get/set weights roundtrip', () => {
    const net = new FeedforwardNetwork([4, 3, 2]);
    const w = new Float32Array(net.weightCount);
    for (let i = 0; i < w.length; i++) w[i] = i * 0.01;
    net.setWeights(w);
    const out = net.getWeights();
    expect(out.length).toBe(w.length);
    for (let i = 0; i < w.length; i++) {
      expect(out[i]).toBeCloseTo(w[i], 5);
    }
  });

  it('throws on wrong weight count', () => {
    const net = new FeedforwardNetwork([4, 3, 2]);
    expect(() => net.setWeights(new Float32Array(5))).toThrow();
  });

  it('forward pass is deterministic', () => {
    const net = new FeedforwardNetwork([3, 4, 2]);
    const w = new Float32Array(net.weightCount);
    for (let i = 0; i < w.length; i++) w[i] = (i - w.length / 2) * 0.05;
    net.setWeights(w);

    const input = new Float32Array([0.5, -0.3, 0.8]);
    const out1 = net.forward(input);
    const out2 = net.forward(input);
    expect(out1.length).toBe(2);
    for (let i = 0; i < 2; i++) {
      expect(out1[i]).toBe(out2[i]);
    }
  });

  it('ReLU activates on hidden layers only', () => {
    const net = new FeedforwardNetwork([2, 2, 1]);
    // Set weights so hidden produces negative values, output can be negative
    const w = new Float32Array(net.weightCount);
    w.fill(-1);
    net.setWeights(w);

    const input = new Float32Array([1, 1]);
    const hidden = [-1 * 1 + -1 * 1 + -1, -1 * 1 + -1 * 1 + -1]; // [-3, -3]
    // After ReLU: [0, 0]
    // Output: -1*0 + -1*0 + -1 = -1 (negative is allowed on output)
    const out = net.forward(input);
    expect(out[0]).toBe(-1);
  });

  it('JSON roundtrip preserves network', () => {
    const net = new FeedforwardNetwork([5, 3, 2]);
    const w = new Float32Array(net.weightCount);
    for (let i = 0; i < w.length; i++) w[i] = Math.sin(i);
    net.setWeights(w);

    const json = net.toJSON();
    const net2 = FeedforwardNetwork.fromJSON(json);

    expect(net2.topology).toEqual([5, 3, 2]);
    expect(net2.weightCount).toBe(net.weightCount);

    const input = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
    const out1 = net.forward(input);
    const out2 = net2.forward(input);
    for (let i = 0; i < out1.length; i++) {
      expect(out1[i]).toBeCloseTo(out2[i], 5);
    }
  });

  it('handles array input (not just Float32Array)', () => {
    const net = new FeedforwardNetwork([2, 2]);
    const w = new Float32Array(net.weightCount);
    w.fill(0.5);
    net.setWeights(w);

    const out = net.forward([1, 1]);
    expect(out.length).toBe(2);
    expect(typeof out[0]).toBe('number');
  });
});

describe('encodeObservation', () => {
  function makeMockSensorObs() {
    return {
      hpRatio: 0.8,
      weaponReady: true,
      weaponCooldownRatio: 0.2,
      weaponRange: 150,
      enemiesInArc: 3,
      nearEnemyCount: 5,
      midEnemyCount: 12,
      farEnemyCount: 20,
      sectorDensity: [2, 3, 1, 0, 4, 2, 1, 3],
      sectorThreat: [100, 200, 50, 0, 300, 100, 25, 150],
      nearestEnemyDist: 120,
      nearestEnemyAngle: 1.2,
      nearestPickupDist: 200,
      nearestPickupAngle: -0.5,
      recentDamageTaken: 10,
      playerMaxHP: 100,
      gameTime: 60,
      totalEnemies: 30,
      distToEdge: 300,
      safestDirX: 0.7,
      safestDirY: -0.7,
      encirclement: 0.5,
      localThreat: 3,
      preferredRange: 120,
      dirDanger: [20, 40, 10, 5, 50, 30, 8, 25],
      dirReward: [1, 0.5, 0, 0, 2, 1, 0, 0.5],
      playerX: 2048,
      playerY: 2048,
    };
  }

  it('produces correct length', () => {
    const obs = makeMockSensorObs();
    const encoded = encodeObservation(obs);
    expect(encoded.length).toBe(INPUT_SIZE);
    expect(INPUT_SIZE).toBe(53);
  });

  it('values are in normalized range', () => {
    const obs = makeMockSensorObs();
    const encoded = encodeObservation(obs);
    for (let i = 0; i < encoded.length; i++) {
      expect(encoded[i]).toBeGreaterThanOrEqual(-2);
      expect(encoded[i]).toBeLessThanOrEqual(2);
    }
  });

  it('reuses pre-allocated buffer', () => {
    const obs = makeMockSensorObs();
    const buf = new Float32Array(INPUT_SIZE);
    const result = encodeObservation(obs, buf);
    expect(result).toBe(buf);
    expect(buf[0]).toBeCloseTo(0.8); // hpRatio
  });

  it('handles missing optional fields gracefully', () => {
    const obs = {
      hpRatio: 1,
      weaponReady: false,
      nearEnemyCount: 0,
      midEnemyCount: 0,
      farEnemyCount: 0,
      sectorDensity: [0, 0, 0, 0, 0, 0, 0, 0],
      sectorThreat: [0, 0, 0, 0, 0, 0, 0, 0],
      nearestEnemyDist: 500,
      nearestPickupDist: 500,
      playerMaxHP: 100,
      recentDamageTaken: 0,
      totalEnemies: 0,
      distToEdge: 200,
    };
    // Should not throw
    const encoded = encodeObservation(obs);
    expect(encoded.length).toBe(INPUT_SIZE);
  });
});

describe('Neural policy interface', () => {
  // Import registers the policy
  it('registers as neural policy', async () => {
    await import('../src/ai/neural/neural-policy.js');
    const { createPolicy, listPolicies } = await import('../src/ai/policy-types.js');
    expect(listPolicies()).toContain('neural');
  });

  it('implements full policy interface', async () => {
    const { createPolicy } = await import('../src/ai/policy-types.js');
    const policy = createPolicy('neural');

    expect(policy.name).toBe('Neural');
    expect(policy.id).toBe('neural');
    expect(typeof policy.reset).toBe('function');
    expect(typeof policy.act).toBe('function');
    expect(typeof policy.chooseUpgrade).toBe('function');
  });

  it('act returns valid action shape', async () => {
    const { createPolicy } = await import('../src/ai/policy-types.js');
    const policy = createPolicy('neural');
    policy.reset();

    const mockObs = {
      playerX: 2048, playerY: 2048,
      playerHP: 100, playerMaxHP: 100,
      hpRatio: 1, level: 1, xp: 0, xpToNext: 100, xpRatio: 0,
      weapon: 'sword', weaponReady: true, weaponCooldownRatio: 0,
      weaponRange: 80, enemiesInArc: 0,
      nearEnemyCount: 0, midEnemyCount: 0, farEnemyCount: 0,
      sectorDensity: [0, 0, 0, 0, 0, 0, 0, 0],
      sectorThreat: [0, 0, 0, 0, 0, 0, 0, 0],
      nearestEnemyDist: 500, nearestEnemyAngle: 0,
      nearestEnemyX: 2548, nearestEnemyY: 2048,
      nearestPickupDist: 500, nearestPickupAngle: 0,
      nearestPickupX: 2048, nearestPickupY: 2548,
      recentDamageTaken: 0, gameTime: 0, wave: 0,
      totalKills: 0, totalEnemies: 0,
      worldW: 4096, worldH: 4096, distToEdge: 2048,
      safestDirX: 1, safestDirY: 0,
      acquiredUpgrades: [], activeEffects: [],
    };

    const action = policy.act(mockObs);
    expect(typeof action.dx).toBe('number');
    expect(typeof action.dy).toBe('number');
    expect(typeof action.attack).toBe('boolean');
    expect(typeof action.targetX).toBe('number');
    expect(typeof action.targetY).toBe('number');
    expect(action.dx).toBeGreaterThanOrEqual(-1);
    expect(action.dx).toBeLessThanOrEqual(1);
    expect(action.dy).toBeGreaterThanOrEqual(-1);
    expect(action.dy).toBeLessThanOrEqual(1);
  });

  it('accepts custom weights', async () => {
    const { createPolicy } = await import('../src/ai/policy-types.js');
    const net = new FeedforwardNetwork([INPUT_SIZE, 32, 16, 4]);
    const w = net.getWeights();
    w.fill(0.01);

    const policy = createPolicy('neural', { weights: w });
    policy.reset();

    const action = policy.act({
      playerX: 2048, playerY: 2048,
      playerHP: 100, playerMaxHP: 100,
      hpRatio: 1, level: 1, xp: 0, xpToNext: 100, xpRatio: 0,
      weapon: 'sword', weaponReady: true, weaponCooldownRatio: 0,
      weaponRange: 80, enemiesInArc: 0,
      nearEnemyCount: 1, midEnemyCount: 3, farEnemyCount: 5,
      sectorDensity: [1, 0, 2, 0, 1, 0, 1, 0],
      sectorThreat: [50, 0, 100, 0, 50, 0, 25, 0],
      nearestEnemyDist: 100, nearestEnemyAngle: 0.5,
      nearestEnemyX: 2148, nearestEnemyY: 2048,
      nearestPickupDist: 300, nearestPickupAngle: -1,
      nearestPickupX: 1800, nearestPickupY: 2048,
      recentDamageTaken: 5, gameTime: 30, wave: 1,
      totalKills: 10, totalEnemies: 8,
      worldW: 4096, worldH: 4096, distToEdge: 2048,
      safestDirX: -0.5, safestDirY: 0.5,
      acquiredUpgrades: [], activeEffects: [],
    });

    expect(typeof action.dx).toBe('number');
  });
});
