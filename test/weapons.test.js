/**
 * Weapon system tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadEngine } from '../src/engine/loader.js';
import { EngineBindings, TYPE, STATE, FIELD } from '../src/engine/bindings.js';
import { createWeaponSystem } from '../src/systems/weapons.js';
import { clearEffects } from '../src/renderer/effects.js';

let engine, weapons;

beforeEach(async () => {
  const wasm = await loadEngine();
  engine = new EngineBindings(wasm);
  engine.init(4096, 4096);
  weapons = createWeaponSystem(engine);
  clearEffects();
});

describe('Sword (default weapon)', () => {
  it('starts with sword', () => {
    expect(weapons.currentWeapon).toBe('sword');
  });

  it('damages enemies in a cone toward the mouse', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    // Enemy directly to the right of the player, within sword range
    const eid = engine.spawnEntity(TYPE.ENEMY_BASIC, 2100, 2048, 30, 60, 10, 8, 10);

    // Need to rebuild grid so grid_query finds the enemy
    engine.step(1 / 60);

    // Attack toward the right (target x > player x)
    weapons.update(1 / 60, 2048, 2048, 2200, 2048, true);

    expect(engine.getEntityHP(eid)).toBeLessThan(30);
  });

  it('does not hit enemies outside the cone', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    // Enemy directly behind the player (to the left)
    const eid = engine.spawnEntity(TYPE.ENEMY_BASIC, 1990, 2048, 30, 60, 10, 8, 10);

    engine.step(1 / 60);

    // Attack toward the right
    weapons.update(1 / 60, 2048, 2048, 2200, 2048, true);

    expect(engine.getEntityHP(eid)).toBe(30);
  });

  it('does not hit enemies beyond sword range', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    // Enemy far to the right, beyond 75 range
    const eid = engine.spawnEntity(TYPE.ENEMY_BASIC, 2200, 2048, 30, 60, 10, 8, 10);

    engine.step(1 / 60);

    weapons.update(1 / 60, 2048, 2048, 2300, 2048, true);

    expect(engine.getEntityHP(eid)).toBe(30);
  });

  it('applies stun that slows enemies', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    const eid = engine.spawnEntity(TYPE.ENEMY_BASIC, 2100, 2048, 100, 60, 10, 8, 10);

    engine.step(1 / 60);

    // Attack
    weapons.update(1 / 60, 2048, 2048, 2200, 2048, true);

    // Speed should be reduced (60 * 0.15 = 9)
    expect(engine.getEntitySpeed(eid)).toBeCloseTo(9);
  });

  it('stun wears off and speed restores', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    const eid = engine.spawnEntity(TYPE.ENEMY_BASIC, 2100, 2048, 100, 60, 10, 8, 10);

    engine.step(1 / 60);

    // Attack (stun duration is 0.25s)
    weapons.update(1 / 60, 2048, 2048, 2200, 2048, true);
    expect(engine.getEntitySpeed(eid)).toBeCloseTo(9);

    // Tick past stun duration (no attack this time)
    weapons.update(0.3, 2048, 2048, 2200, 2048, false);

    // Speed should be restored
    expect(engine.getEntitySpeed(eid)).toBeCloseTo(60);
  });

  it('hits multiple enemies in the cone', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    const e1 = engine.spawnEntity(TYPE.ENEMY_BASIC, 2090, 2038, 30, 60, 10, 8, 10);
    const e2 = engine.spawnEntity(TYPE.ENEMY_BASIC, 2090, 2058, 30, 60, 10, 8, 10);

    engine.step(1 / 60);

    weapons.update(1 / 60, 2048, 2048, 2200, 2048, true);

    expect(engine.getEntityHP(e1)).toBeLessThan(30);
    expect(engine.getEntityHP(e2)).toBeLessThan(30);
  });

  it('respects cooldown between swings', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    const eid = engine.spawnEntity(TYPE.ENEMY_BASIC, 2100, 2048, 200, 60, 10, 8, 10);

    engine.step(1 / 60);

    // First swing
    weapons.update(1 / 60, 2048, 2048, 2200, 2048, true);
    const hp1 = engine.getEntityHP(eid);

    // Immediate second swing should be blocked by cooldown
    weapons.update(1 / 60, 2048, 2048, 2200, 2048, true);
    expect(engine.getEntityHP(eid)).toBe(hp1);

    // After cooldown passes
    weapons.update(0.5, 2048, 2048, 2200, 2048, true);
    expect(engine.getEntityHP(eid)).toBeLessThan(hp1);
  });

  it('damage multiplier scales sword damage', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    const eid = engine.spawnEntity(TYPE.ENEMY_BASIC, 2100, 2048, 200, 60, 10, 8, 10);

    engine.step(1 / 60);

    weapons.damageMultiplier = 2;
    weapons.update(1 / 60, 2048, 2048, 2200, 2048, true);

    // 35 base * 2 = 70 damage, so 200 - 70 = 130
    expect(engine.getEntityHP(eid)).toBeCloseTo(130);
  });
});

describe('Projectile weapons', () => {
  it('shotgun spawns multiple projectiles', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    weapons.currentWeapon = 'shotgun';
    weapons.update(1 / 60, 2048, 2048, 2200, 2048, true);

    expect(engine.countByType(10, 19)).toBe(5);
  });

  it('nova spawns projectiles in all directions', () => {
    const pid = engine.spawnEntity(TYPE.PLAYER, 2048, 2048, 100, 180, 12, 0, 0);
    engine.setPlayerId(pid);

    weapons.currentWeapon = 'nova';
    weapons.update(1 / 60, 2048, 2048, 2200, 2048, true);

    expect(engine.countByType(10, 19)).toBe(12);
  });
});
