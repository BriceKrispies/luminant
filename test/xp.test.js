/**
 * XP and leveling system tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadEngine } from '../src/engine/loader.js';
import { EngineBindings, TYPE, STATE } from '../src/engine/bindings.js';
import { createXPSystem } from '../src/systems/xp.js';

let engine, xp;

beforeEach(async () => {
  const wasm = await loadEngine();
  engine = new EngineBindings(wasm);
  engine.init(4096, 4096);
  xp = createXPSystem(engine);
});

describe('XP System', () => {
  it('starts at level 1 with zero XP', () => {
    expect(xp.level).toBe(1);
    expect(xp.xp).toBe(0);
    expect(xp.pendingLevelUps).toBe(0);
  });

  it('processes dying enemies and spawns XP pickups', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    const eid = engine.spawnEntity(TYPE.ENEMY_BASIC, 500, 500, 10, 60, 10, 8, 15);
    // Kill the enemy
    engine.applyDamage(eid, 20);
    engine.step(1 / 60); // process_deaths marks it dying

    const activeBeforeProcess = engine.getActiveCount();
    xp.processDyingEntities();

    // Enemy should be despawned, XP pickup should be spawned
    // Active count: was 2 (player+enemy), enemy despawned(-1), pickup spawned(+1) = still 2
    expect(engine.getActiveCount()).toBe(2);
  });

  it('collects XP from dying pickups', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    // Manually create a dying XP pickup (simulating player collection)
    const pickId = engine.spawnEntity(TYPE.PICKUP_XP, 2050, 2048, 1, 0, 15, 0, 25);
    // Mark as dying (collected)
    engine.setI32(pickId, 28, STATE.DYING);

    xp.processDyingEntities();
    expect(xp.xp).toBe(25);
  });

  it('levels up when XP threshold is reached', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    // Add enough XP for a level-up via dying pickups
    for (let i = 0; i < 10; i++) {
      const pickId = engine.spawnEntity(TYPE.PICKUP_XP, 100 + i * 50, 100, 1, 0, 15, 0, 20);
      engine.setI32(pickId, 28, STATE.DYING);
    }

    xp.processDyingEntities();
    // 200 XP total, level 1 needs 50 XP → should have leveled up multiple times
    expect(xp.level).toBeGreaterThan(1);
    expect(xp.pendingLevelUps).toBeGreaterThan(0);
  });

  it('consumeLevelUp decrements pending count', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    // Force level-ups
    for (let i = 0; i < 20; i++) {
      const pickId = engine.spawnEntity(TYPE.PICKUP_XP, 100 + i * 50, 100, 1, 0, 15, 0, 20);
      engine.setI32(pickId, 28, STATE.DYING);
    }
    xp.processDyingEntities();

    const before = xp.pendingLevelUps;
    expect(before).toBeGreaterThan(0);

    xp.consumeLevelUp();
    expect(xp.pendingLevelUps).toBe(before - 1);
  });
});
