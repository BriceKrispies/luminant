/**
 * Benchmark sanity tests — ensure benchmarks can run without errors
 * and that performance stays within a reasonable range.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadEngine } from '../src/engine/loader.js';
import { EngineBindings, TYPE } from '../src/engine/bindings.js';
import { SCENARIOS, loadScenario } from '../harness/scenarios.js';

let wasm;

beforeEach(async () => {
  wasm = await loadEngine();
});

describe('Benchmark scenarios', () => {
  it('basicSwarm scenario loads and runs', () => {
    const engine = new EngineBindings(wasm);
    const { playerId, spawned } = loadScenario(engine, SCENARIOS.basicSwarm);
    expect(playerId).toBeGreaterThanOrEqual(0);
    expect(spawned).toBe(200);

    for (let i = 0; i < 60; i++) engine.step(1 / 60);
    expect(engine.getActiveCount()).toBeGreaterThan(0);
  });

  it('mixedTypes scenario loads and runs', () => {
    const engine = new EngineBindings(wasm);
    const { spawned } = loadScenario(engine, SCENARIOS.mixedTypes);
    expect(spawned).toBe(180);

    for (let i = 0; i < 60; i++) engine.step(1 / 60);
    expect(engine.getActiveCount()).toBeGreaterThan(0);
  });

  it('stress scenario handles 2000 entities', () => {
    const engine = new EngineBindings(wasm);
    const { spawned } = loadScenario(engine, SCENARIOS.stress);
    expect(spawned).toBe(2000);

    // Run 10 frames — should complete without error
    for (let i = 0; i < 10; i++) engine.step(1 / 60);
    expect(engine.getActiveCount()).toBe(2001); // 2000 enemies + player
  });

  it('step time stays under 16ms for 500 enemies', () => {
    const engine = new EngineBindings(wasm);
    engine.init(4096, 4096);
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 9999, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    for (let i = 0; i < 500; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 300 + Math.random() * 600;
      engine.spawnEntity(TYPE.ENEMY_BASIC,
        2048 + Math.cos(a) * d, 2048 + Math.sin(a) * d,
        30, 60, 10, 8, 10);
    }

    // Warm up
    for (let i = 0; i < 5; i++) engine.step(1 / 60);

    // Measure
    const times = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      engine.step(1 / 60);
      times.push(performance.now() - t0);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    expect(avg).toBeLessThan(16.67); // Must fit in 60fps budget
  });
});
