/**
 * Spawner system tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadEngine } from '../src/engine/loader.js';
import { EngineBindings, TYPE } from '../src/engine/bindings.js';
import { createSpawnerSystem } from '../src/systems/spawner.js';

let engine, spawner;

beforeEach(async () => {
  const wasm = await loadEngine();
  engine = new EngineBindings(wasm);
  engine.init(4096, 4096);
  spawner = createSpawnerSystem(engine);
});

describe('Spawner', () => {
  it('spawns a wave of enemies', () => {
    const ids = spawner.spawnWave(10, 2048, 2048, ['basic']);
    expect(ids.length).toBe(10);
    expect(engine.getActiveCount()).toBe(10);
  });

  it('spawns enemies at distance from player', () => {
    const ids = spawner.spawnWave(5, 2048, 2048, ['basic'], 400, 700);
    for (const id of ids) {
      const dx = engine.getEntityX(id) - 2048;
      const dy = engine.getEntityY(id) - 2048;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Should be roughly within spawn distance (allowing for world clamping)
      expect(dist).toBeGreaterThan(100);
    }
  });

  it('spawns mixed enemy types', () => {
    const ids = spawner.spawnWave(50, 2048, 2048, ['basic', 'fast', 'tank']);
    const types = new Set();
    for (const id of ids) {
      types.add(engine.getEntityType(id));
    }
    // Should have at least 2 different types (3 if RNG cooperates)
    expect(types.size).toBeGreaterThanOrEqual(2);
  });

  it('spawns a single specific enemy', () => {
    const id = spawner.spawnOne('tank', 1000, 1000);
    expect(id).toBeGreaterThanOrEqual(0);
    expect(engine.getEntityType(id)).toBe(TYPE.ENEMY_TANK);
    expect(engine.getEntityHP(id)).toBe(120);
  });
});
