/**
 * Enemy pursuit behavior tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadEngine } from '../src/engine/loader.js';
import { EngineBindings, TYPE } from '../src/engine/bindings.js';

let engine;

beforeEach(async () => {
  const wasm = await loadEngine();
  engine = new EngineBindings(wasm);
  engine.init(4096, 4096);
});

describe('Enemy pursuit', () => {
  it('enemies move toward the player', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);
    engine.setPlayerInput(0, 0, 0);

    const eid = engine.spawnEntity(TYPE.ENEMY_BASIC, 2048 + 300, 2048, 30, 60, 10, 8, 10);

    const startX = engine.getEntityX(eid);

    // Step several frames
    for (let i = 0; i < 30; i++) engine.step(1 / 60);

    const endX = engine.getEntityX(eid);
    // Enemy should be closer to player (moved left toward x=2048)
    expect(endX).toBeLessThan(startX);
  });

  it('enemies from different directions converge', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 0, 12, 0, 0);
    engine.setPlayerId(pid);
    engine.setPlayerInput(0, 0, 0);

    const left = engine.spawnEntity(TYPE.ENEMY_BASIC, 1748, 2048, 30, 60, 10, 8, 10);
    const right = engine.spawnEntity(TYPE.ENEMY_BASIC, 2348, 2048, 30, 60, 10, 8, 10);
    const above = engine.spawnEntity(TYPE.ENEMY_BASIC, 2048, 1748, 30, 60, 10, 8, 10);

    for (let i = 0; i < 60; i++) engine.step(1 / 60);

    // All should be closer to player
    expect(engine.getEntityX(left)).toBeGreaterThan(1748);
    expect(engine.getEntityX(right)).toBeLessThan(2348);
    expect(engine.getEntityY(above)).toBeGreaterThan(1748);
  });

  it('fast enemies move faster than basic enemies', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 0, 12, 0, 0);
    engine.setPlayerId(pid);
    engine.setPlayerInput(0, 0, 0);

    const basic = engine.spawnEntity(TYPE.ENEMY_BASIC, 2348, 2048, 30, 60, 10, 8, 10);
    const fast = engine.spawnEntity(TYPE.ENEMY_FAST, 2348, 2148, 15, 120, 7, 5, 8);

    for (let i = 0; i < 60; i++) engine.step(1 / 60);

    const basicDist = Math.abs(engine.getEntityX(basic) - 2048);
    const fastDist = Math.sqrt(
      Math.pow(engine.getEntityX(fast) - 2048, 2) +
      Math.pow(engine.getEntityY(fast) - 2048, 2)
    );

    // Fast enemy should be closer to player
    expect(fastDist).toBeLessThan(basicDist);
  });
});

describe('Enemy separation', () => {
  it('overlapping enemies push apart', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 0, 12, 0, 0);
    engine.setPlayerId(pid);
    engine.setPlayerInput(0, 0, 0);

    // Spawn two enemies at nearly the same position with slight Y offset
    const e1 = engine.spawnEntity(TYPE.ENEMY_BASIC, 2200, 2047, 30, 60, 10, 8, 10);
    const e2 = engine.spawnEntity(TYPE.ENEMY_BASIC, 2200, 2049, 30, 60, 10, 8, 10);

    for (let i = 0; i < 60; i++) engine.step(1 / 60);

    const y1 = engine.getEntityY(e1);
    const y2 = engine.getEntityY(e2);

    // They should maintain some separation (pursuit dominates, but separation prevents collapse)
    expect(Math.abs(y1 - y2)).toBeGreaterThan(0.5);
  });
});
