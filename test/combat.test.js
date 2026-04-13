/**
 * Combat and collision tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadEngine } from '../src/engine/loader.js';
import { EngineBindings, TYPE, STATE } from '../src/engine/bindings.js';

let engine;

beforeEach(async () => {
  const wasm = await loadEngine();
  engine = new EngineBindings(wasm);
  engine.init(4096, 4096);
});

describe('Projectile-enemy collision', () => {
  it('projectile damages enemy on contact', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    // Spawn enemy right in front of projectile path
    const eid = engine.spawnEntity(TYPE.ENEMY_BASIC, 2100, 2048, 30, 0, 10, 8, 10);

    // Spawn projectile heading toward enemy
    const projId = engine.spawnEntity(TYPE.PROJECTILE_BULLET, 2048, 2048, 1, 500, 5, 15, 0);
    engine.setEntityVelocity(projId, 500, 0);
    engine.setEntityLifetime(projId, 2);

    // Step until collision
    for (let i = 0; i < 30; i++) engine.step(1 / 60);

    // Enemy should have taken damage
    expect(engine.getEntityHP(eid)).toBeLessThan(30);
  });

  it('projectile despawns after hitting an enemy', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    const eid = engine.spawnEntity(TYPE.ENEMY_BASIC, 2080, 2048, 100, 0, 10, 8, 10);
    const projId = engine.spawnEntity(TYPE.PROJECTILE_BULLET, 2048, 2048, 1, 500, 5, 15, 0);
    engine.setEntityVelocity(projId, 500, 0);
    engine.setEntityLifetime(projId, 2);

    for (let i = 0; i < 30; i++) engine.step(1 / 60);

    // Projectile should be despawned (state = FREE)
    expect(engine.getEntityState(projId)).toBe(STATE.FREE);
  });
});

describe('Enemy-player contact damage', () => {
  it('enemy damages player on contact', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 0, 12, 0, 0);
    engine.setPlayerId(pid);
    engine.setPlayerInput(0, 0, 0);

    // Spawn enemy right on top of player
    engine.spawnEntity(TYPE.ENEMY_BASIC, 2050, 2048, 30, 0, 10, 8, 10);

    // Step to trigger collision
    engine.step(1 / 60);

    expect(engine.getEntityHP(pid)).toBeLessThan(100);
  });

  it('enemy has cooldown after dealing damage', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 0, 12, 0, 0);
    engine.setPlayerId(pid);
    engine.setPlayerInput(0, 0, 0);

    engine.spawnEntity(TYPE.ENEMY_BASIC, 2050, 2048, 30, 0, 10, 8, 10);

    // First hit
    engine.step(1 / 60);
    const hp1 = engine.getEntityHP(pid);

    // Second step - should not deal damage again (cooldown)
    engine.step(1 / 60);
    const hp2 = engine.getEntityHP(pid);

    expect(hp2).toBeCloseTo(hp1);
  });
});

describe('Projectile lifetime', () => {
  it('projectiles despawn when lifetime expires', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    const projId = engine.spawnEntity(TYPE.PROJECTILE_BULLET, 2048, 2048, 1, 300, 4, 15, 0);
    engine.setEntityVelocity(projId, 300, 0);
    engine.setEntityLifetime(projId, 0.5);

    // Step for 1 second (60 frames)
    for (let i = 0; i < 60; i++) engine.step(1 / 60);

    expect(engine.getEntityState(projId)).toBe(STATE.FREE);
  });
});
