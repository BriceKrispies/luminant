/**
 * Determinism tests — same inputs should produce same outputs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadEngine } from '../src/engine/loader.js';
import { EngineBindings, TYPE, FIELD, ENTITY_STRIDE, MAX_ENTITIES } from '../src/engine/bindings.js';

let wasm;

beforeEach(async () => {
  wasm = await loadEngine();
});

function setupScenario(engine) {
  engine.init(4096, 4096);
  const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
  engine.setPlayerId(pid);
  engine.setPlayerInput(0.5, -0.3, 0);

  // Spawn enemies in deterministic positions
  for (let i = 0; i < 50; i++) {
    const x = 2048 + Math.cos(i * 0.5) * (300 + i * 5);
    const y = 2048 + Math.sin(i * 0.5) * (300 + i * 5);
    engine.spawnEntity(TYPE.ENEMY_BASIC, x, y, 30, 60, 10, 8, 10);
  }
}

function snapshotPositions(engine) {
  const positions = [];
  for (let id = 0; id < MAX_ENTITIES; id++) {
    const base = id * ENTITY_STRIDE;
    const state = engine.mem.getInt32(base + FIELD.STATE, true);
    if (state === 0) continue;
    positions.push({
      id,
      x: engine.mem.getFloat32(base + FIELD.X, true),
      y: engine.mem.getFloat32(base + FIELD.Y, true),
    });
  }
  return positions;
}

describe('Simulation determinism', () => {
  it('two runs with same setup produce identical positions', () => {
    // Run 1
    const engine1 = new EngineBindings(wasm);
    setupScenario(engine1);
    for (let i = 0; i < 120; i++) engine1.step(1 / 60);
    const snap1 = snapshotPositions(engine1);

    // Run 2 — fresh engine, same setup
    const engine2 = new EngineBindings(wasm);
    setupScenario(engine2);
    for (let i = 0; i < 120; i++) engine2.step(1 / 60);
    const snap2 = snapshotPositions(engine2);

    expect(snap1.length).toBe(snap2.length);
    for (let i = 0; i < snap1.length; i++) {
      expect(snap1[i].x).toBeCloseTo(snap2[i].x, 4);
      expect(snap1[i].y).toBeCloseTo(snap2[i].y, 4);
    }
  });
});
