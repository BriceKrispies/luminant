/**
 * Tests for neural AI diagnostics — behavioral classification.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createNeuralDiagnostics } from '../src/ai/neural/neural-diagnostics.js';

function makeSensorData(overrides = {}) {
  return {
    hpRatio: 1,
    encirclement: 0,
    nearestEnemyDist: 200,
    localThreat: 0,
    nearEnemyCount: 0,
    distToEdge: 500,
    recentDamageTaken: 0,
    playerMaxHP: 100,
    closingSpeed: 0,
    ...overrides,
  };
}

const rawOutput = new Float32Array([0.5, 0.5, 1.0, 0.0]);

describe('Neural diagnostics', () => {
  let diag;

  beforeEach(() => {
    diag = createNeuralDiagnostics();
  });

  it('classifies idle when low movement and low threat', () => {
    const result = diag.classify(makeSensorData(), rawOutput, 0.05, 0.05, false);
    expect(result.state).toBe('idle');
  });

  it('classifies active as default', () => {
    const result = diag.classify(makeSensorData({ localThreat: 3 }), rawOutput, 0.5, 0.5, false);
    expect(result.state).toBe('active');
  });

  it('classifies cornered near edge with encirclement', () => {
    const sensor = makeSensorData({ distToEdge: 40, encirclement: 0.7 });
    const result = diag.classify(sensor, rawOutput, 0.5, 0.5, false);
    expect(result.state).toBe('cornered');
  });

  it('classifies overwhelmed with many enemies and encirclement', () => {
    const sensor = makeSensorData({ nearEnemyCount: 12, encirclement: 0.6 });
    const result = diag.classify(sensor, rawOutput, 0.5, 0.5, false);
    expect(result.state).toBe('overwhelmed');
  });

  it('classifies overwhelmed with high damage and encirclement', () => {
    const sensor = makeSensorData({
      recentDamageTaken: 30, playerMaxHP: 100, encirclement: 0.5,
    });
    const result = diag.classify(sensor, rawOutput, 0.5, 0.5, false);
    expect(result.state).toBe('overwhelmed');
  });

  it('classifies stuck after consecutive low-movement frames', () => {
    const sensor = makeSensorData();
    for (let i = 0; i < 15; i++) {
      diag.classify(sensor, rawOutput, 0.01, 0.01, false);
    }
    const result = diag.classify(sensor, rawOutput, 0.01, 0.01, false);
    expect(result.state).toBe('stuck');
    expect(result.stuckFrames).toBeGreaterThan(10);
  });

  it('resets stuck counter when movement resumes', () => {
    const sensor = makeSensorData({ localThreat: 3 });
    for (let i = 0; i < 15; i++) {
      diag.classify(sensor, rawOutput, 0.01, 0.01, false);
    }
    const result = diag.classify(sensor, rawOutput, 0.8, 0.8, false);
    expect(result.stuckFrames).toBe(0);
    expect(result.state).not.toBe('stuck');
  });

  it('classifies kiting when moving away and attacking', () => {
    const sensor = makeSensorData({ closingSpeed: -3 });
    const result = diag.classify(sensor, rawOutput, 0.6, 0.6, true);
    expect(result.state).toBe('kiting');
  });

  it('classifies diving when closing in and attacking', () => {
    const sensor = makeSensorData({ closingSpeed: 3 });
    const result = diag.classify(sensor, rawOutput, 0.6, 0.6, true);
    expect(result.state).toBe('diving');
  });

  it('reset clears stuck counter', () => {
    const sensor = makeSensorData();
    for (let i = 0; i < 15; i++) {
      diag.classify(sensor, rawOutput, 0.01, 0.01, false);
    }
    diag.reset();
    const result = diag.classify(sensor, rawOutput, 0.01, 0.01, false);
    expect(result.stuckFrames).toBe(1);
  });

  it('returns expected output shape', () => {
    const result = diag.classify(makeSensorData(), rawOutput, 0.5, 0.5, false);
    expect(result).toHaveProperty('state');
    expect(result).toHaveProperty('stuckFrames');
    expect(result).toHaveProperty('moveMag');
    expect(result).toHaveProperty('rawOutput');
    expect(result).toHaveProperty('keyInputs');
    expect(typeof result.state).toBe('string');
    expect(typeof result.stuckFrames).toBe('number');
    expect(typeof result.moveMag).toBe('number');
    const k = result.keyInputs;
    expect(typeof k.hpRatio).toBe('number');
    expect(typeof k.encirclement).toBe('number');
    expect(typeof k.nearestEnemyDist).toBe('number');
    expect(typeof k.localThreat).toBe('number');
    expect(typeof k.nearEnemyCount).toBe('number');
    expect(typeof k.distToEdge).toBe('number');
    expect(typeof k.recentDamageFrac).toBe('number');
    expect(typeof k.closingSpeed).toBe('number');
  });

  it('cornered takes priority over overwhelmed', () => {
    const sensor = makeSensorData({
      distToEdge: 40, encirclement: 0.7, nearEnemyCount: 12,
    });
    const result = diag.classify(sensor, rawOutput, 0.5, 0.5, false);
    expect(result.state).toBe('cornered');
  });

  it('computes movement magnitude correctly', () => {
    const result = diag.classify(makeSensorData({ localThreat: 3 }), rawOutput, 0.3, 0.4, false);
    expect(result.moveMag).toBeCloseTo(0.5, 5);
  });
});
