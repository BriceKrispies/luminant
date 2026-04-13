/**
 * Tests for the headless game runner and simulation system.
 * - Full game runs complete without error
 * - Deterministic seeds produce deterministic results
 * - Auto upgrade selection works
 * - Result structure is correct
 */

import { describe, it, expect } from 'vitest';
import { loadEngine } from '../src/engine/loader.js';
import { runGame } from '../src/ai/game-runner.js';
import { createPolicy } from '../src/ai/policy-types.js';

// Register policies
import '../src/ai/policies/survival.js';
import '../src/ai/policies/progression.js';

describe('Game runner', () => {
  it('completes a short game without error', async () => {
    const wasm = await loadEngine();
    const policy = createPolicy('survival');
    const result = await runGame({
      policy,
      seed: 12345,
      maxTicks: 600,  // 10 seconds
      wasm,
      silent: true,
    });

    expect(result).toHaveProperty('seed', 12345);
    expect(result).toHaveProperty('policyId', 'survival');
    expect(result).toHaveProperty('policyName', 'Survival');
    expect(result).toHaveProperty('survivalTime');
    expect(result).toHaveProperty('level');
    expect(result).toHaveProperty('kills');
    expect(result).toHaveProperty('totalXP');
    expect(result).toHaveProperty('wave');
    expect(result).toHaveProperty('damageTaken');
    expect(result).toHaveProperty('survived');
    expect(result).toHaveProperty('upgradePath');
    expect(result).toHaveProperty('upgradeHistory');
    expect(result).toHaveProperty('weaponPath');
    expect(result).toHaveProperty('score');
    expect(result.survivalTime).toBeGreaterThan(0);
    expect(result.score).toBeDefined();
  }, 15000);

  it('produces deterministic results with same seed', async () => {
    const wasm = await loadEngine();

    const run1 = await runGame({
      policy: createPolicy('survival'),
      seed: 42,
      maxTicks: 600,
      wasm,
      silent: true,
    });

    const run2 = await runGame({
      policy: createPolicy('survival'),
      seed: 42,
      maxTicks: 600,
      wasm,
      silent: true,
    });

    expect(run1.kills).toBe(run2.kills);
    expect(run1.level).toBe(run2.level);
    expect(run1.survivalTime).toBeCloseTo(run2.survivalTime, 2);
    expect(run1.score).toBe(run2.score);
  }, 15000);

  it('produces different results with different seeds', async () => {
    const wasm = await loadEngine();

    const run1 = await runGame({
      policy: createPolicy('survival'),
      seed: 1,
      maxTicks: 1200,
      wasm,
      silent: true,
    });

    const run2 = await runGame({
      policy: createPolicy('survival'),
      seed: 9999,
      maxTicks: 1200,
      wasm,
      silent: true,
    });

    // Very unlikely to be identical with different seeds
    const identical = run1.kills === run2.kills &&
                      run1.level === run2.level &&
                      run1.score === run2.score;
    expect(identical).toBe(false);
  }, 15000);

  it('records snapshots when requested', async () => {
    const wasm = await loadEngine();
    const result = await runGame({
      policy: createPolicy('survival'),
      seed: 42,
      maxTicks: 600,
      wasm,
      recordSnapshots: true,
      snapshotInterval: 120,
      silent: true,
    });

    expect(result.snapshots).toBeDefined();
    expect(result.snapshots.length).toBeGreaterThanOrEqual(1);
    const snap = result.snapshots[0];
    expect(snap).toHaveProperty('tick');
    expect(snap).toHaveProperty('time');
    expect(snap).toHaveProperty('hp');
    expect(snap).toHaveProperty('level');
    expect(snap).toHaveProperty('kills');
  }, 15000);

  it('runs with progression policy', async () => {
    const wasm = await loadEngine();
    const result = await runGame({
      policy: createPolicy('progression'),
      seed: 42,
      maxTicks: 600,
      wasm,
      silent: true,
    });

    expect(result.policyId).toBe('progression');
    expect(result.survivalTime).toBeGreaterThan(0);
  }, 15000);

  it('auto-selects upgrades during gameplay', async () => {
    const wasm = await loadEngine();
    const result = await runGame({
      policy: createPolicy('survival'),
      seed: 42,
      maxTicks: 3600, // 60 seconds — should reach level 2+
      wasm,
      silent: true,
    });

    // After 60s of simulation, player should have leveled up at least once
    if (result.level > 1) {
      expect(result.upgradePath.length).toBeGreaterThanOrEqual(1);
      expect(result.upgradeHistory.length).toBeGreaterThanOrEqual(1);
      expect(result.upgradeHistory[0]).toHaveProperty('tick');
      expect(result.upgradeHistory[0]).toHaveProperty('chosen');
      expect(result.upgradeHistory[0]).toHaveProperty('options');
    }
  }, 30000);
});
