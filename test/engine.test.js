/**
 * Engine core tests — verify WAT module loads, entities spawn, and simulation steps.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadEngine } from '../src/engine/loader.js';
import { EngineBindings, TYPE, STATE, FIELD, MAX_ENTITIES, ENTITY_STRIDE } from '../src/engine/bindings.js';

let engine;

beforeEach(async () => {
  const wasm = await loadEngine();
  engine = new EngineBindings(wasm);
  engine.init(4096, 4096);
});

describe('Engine initialization', () => {
  it('starts with zero active entities', () => {
    expect(engine.getActiveCount()).toBe(0);
  });

  it('has no player by default', () => {
    expect(engine.getPlayerId()).toBe(-1);
  });

  it('starts at time zero', () => {
    expect(engine.getTime()).toBe(0);
  });
});

describe('Entity spawning', () => {
  it('spawns an entity and returns a valid ID', () => {
    const id = engine.spawnEntity(TYPE.ENEMY_BASIC, 100, 200, 30, 60, 10, 8, 10);
    expect(id).toBeGreaterThanOrEqual(0);
    expect(engine.getActiveCount()).toBe(1);
  });

  it('sets entity fields correctly', () => {
    const id = engine.spawnEntity(TYPE.ENEMY_BASIC, 100, 200, 30, 60, 10, 8, 10);
    expect(engine.getEntityX(id)).toBeCloseTo(100);
    expect(engine.getEntityY(id)).toBeCloseTo(200);
    expect(engine.getEntityHP(id)).toBeCloseTo(30);
    expect(engine.getEntityMaxHP(id)).toBeCloseTo(30);
    expect(engine.getEntitySpeed(id)).toBeCloseTo(60);
    expect(engine.getEntityRadius(id)).toBeCloseTo(10);
    expect(engine.getEntityDamage(id)).toBeCloseTo(8);
    expect(engine.getEntityType(id)).toBe(TYPE.ENEMY_BASIC);
    expect(engine.getEntityState(id)).toBe(STATE.ACTIVE);
  });

  it('spawns multiple entities with unique IDs', () => {
    const ids = [];
    for (let i = 0; i < 10; i++) {
      ids.push(engine.spawnEntity(TYPE.ENEMY_BASIC, i * 100, 100, 30, 60, 10, 8, 10));
    }
    expect(new Set(ids).size).toBe(10);
    expect(engine.getActiveCount()).toBe(10);
  });

  it('returns -1 when pool is full', () => {
    for (let i = 0; i < MAX_ENTITIES; i++) {
      engine.spawnEntity(TYPE.ENEMY_BASIC, 100, 100, 1, 1, 1, 1, 1);
    }
    const id = engine.spawnEntity(TYPE.ENEMY_BASIC, 100, 100, 1, 1, 1, 1, 1);
    expect(id).toBe(-1);
  });
});

describe('Entity despawning', () => {
  it('removes an entity and decrements count', () => {
    const id = engine.spawnEntity(TYPE.ENEMY_BASIC, 100, 200, 30, 60, 10, 8, 10);
    expect(engine.getActiveCount()).toBe(1);
    engine.despawnEntity(id);
    expect(engine.getActiveCount()).toBe(0);
    expect(engine.getEntityState(id)).toBe(STATE.FREE);
  });

  it('reuses despawned slots', () => {
    const id1 = engine.spawnEntity(TYPE.ENEMY_BASIC, 100, 100, 30, 60, 10, 8, 10);
    engine.despawnEntity(id1);
    const id2 = engine.spawnEntity(TYPE.ENEMY_BASIC, 200, 200, 30, 60, 10, 8, 10);
    expect(id2).toBe(id1);
  });
});

describe('Simulation step', () => {
  it('advances simulation time', () => {
    engine.step(1 / 60);
    expect(engine.getTime()).toBeGreaterThan(0);
  });

  it('does not crash with no entities', () => {
    engine.step(1 / 60);
    engine.step(1 / 60);
    expect(engine.getActiveCount()).toBe(0);
  });

  it('steps with a player and enemies without error', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);
    for (let i = 0; i < 20; i++) {
      engine.spawnEntity(TYPE.ENEMY_BASIC, 2048 + i * 50, 2048, 30, 60, 10, 8, 10);
    }
    engine.setPlayerInput(1, 0, 0);
    for (let t = 0; t < 60; t++) {
      engine.step(1 / 60);
    }
    // Player should have moved right
    expect(engine.getEntityX(pid)).toBeGreaterThan(2048);
  });
});

describe('Player input', () => {
  it('moves the player based on input direction', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);
    engine.setPlayerInput(1, 0, 0);
    engine.step(1 / 60);
    expect(engine.getEntityX(pid)).toBeGreaterThan(2048);
    expect(engine.getEntityY(pid)).toBeCloseTo(2048, 0);
  });

  it('sets attack flag when attack input is pressed', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);
    engine.setPlayerInput(0, 0, 1);
    engine.step(1 / 60);
    expect(engine.getAttackFlag()).toBe(1);
  });
});

describe('Damage and death', () => {
  it('applies damage to entities', () => {
    const id = engine.spawnEntity(TYPE.ENEMY_BASIC, 100, 100, 30, 60, 10, 8, 10);
    engine.applyDamage(id, 10);
    expect(engine.getEntityHP(id)).toBeCloseTo(20);
  });

  it('marks entities as dying when HP reaches zero', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);
    const id = engine.spawnEntity(TYPE.ENEMY_BASIC, 2048, 2048, 10, 60, 10, 8, 10);
    engine.applyDamage(id, 15);
    engine.step(1 / 60);
    expect(engine.getEntityState(id)).toBe(STATE.DYING);
  });

  it('counts kills for dying enemies', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);
    const id = engine.spawnEntity(TYPE.ENEMY_BASIC, 500, 500, 10, 60, 10, 8, 10);
    engine.applyDamage(id, 15);
    engine.step(1 / 60);
    expect(engine.getKills()).toBe(1);
  });
});
