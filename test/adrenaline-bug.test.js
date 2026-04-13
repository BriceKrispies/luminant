/**
 * Regression test: adrenaline (speed_on_kill) double-subtract bug.
 *
 * The old cleanup logic used three cooldown timers with mismatched durations,
 * causing the speed subtraction to fire twice per adrenaline cycle.
 * Over many kill streaks, player speed goes negative → inverted controls.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadEngine } from '../src/engine/loader.js';
import { EngineBindings, TYPE, FIELD } from '../src/engine/bindings.js';
import { createPlayerSystem } from '../src/systems/player.js';
import { createWeaponSystem } from '../src/systems/weapons.js';
import { createSkillSystem } from '../src/systems/skills.js';
import { createCooldownSystem } from '../src/systems/cooldowns.js';

let engine, player, weapons, skills, cooldowns;
let adrenalineActive;
const BASE_SPEED = 180;

beforeEach(async () => {
  const wasm = await loadEngine();
  engine = new EngineBindings(wasm);
  engine.init(4096, 4096);

  player = createPlayerSystem(engine);
  weapons = createWeaponSystem(engine);
  skills = createSkillSystem(player, weapons);
  cooldowns = createCooldownSystem();
  adrenalineActive = false;

  player.spawn(2048, 2048);
});

/**
 * Simulate the adrenaline logic from main.js for one tick.
 * Must match the fixed version in main.js exactly.
 */
function tickAdrenaline(dt, hasKillsThisFrame) {
  if (skills.hasEffect('speed_on_kill')) {
    if (hasKillsThisFrame) {
      if (!cooldowns.hasEffect('adrenaline')) {
        player.modifySpeed(54);
      }
      cooldowns.addEffect('adrenaline', 2, {});
    } else if (!cooldowns.hasEffect('adrenaline') && adrenalineActive) {
      player.modifySpeed(-54);
      adrenalineActive = false;
    }
    if (cooldowns.hasEffect('adrenaline')) {
      adrenalineActive = true;
    }
  }
  cooldowns.update(dt);
}

function getPlayerSpeed() {
  return engine.getEntitySpeed(player.id);
}

describe('Adrenaline speed bug (reproducer)', () => {
  it('speed returns to base after one adrenaline cycle', () => {
    skills.activeEffects.add('speed_on_kill');

    expect(getPlayerSpeed()).toBeCloseTo(BASE_SPEED);

    // Kill triggers adrenaline
    tickAdrenaline(1 / 60, true);
    expect(getPlayerSpeed()).toBeCloseTo(BASE_SPEED + 54);

    // Wait for adrenaline to expire (2s + margin)
    for (let i = 0; i < 150; i++) {
      tickAdrenaline(1 / 60, false);
    }

    expect(getPlayerSpeed()).toBeCloseTo(BASE_SPEED);
  });

  it('speed stays positive after many adrenaline cycles', () => {
    skills.activeEffects.add('speed_on_kill');

    for (let cycle = 0; cycle < 10; cycle++) {
      tickAdrenaline(1 / 60, true);

      for (let i = 0; i < 180; i++) {
        tickAdrenaline(1 / 60, false);
      }
    }

    const speed = getPlayerSpeed();
    expect(speed).toBeCloseTo(BASE_SPEED);
    expect(speed).toBeGreaterThan(0);
  });

  it('controls never invert (speed never goes negative)', () => {
    skills.activeEffects.add('speed_on_kill');

    let minSpeed = BASE_SPEED;

    for (let cycle = 0; cycle < 20; cycle++) {
      tickAdrenaline(1 / 60, true);

      for (let i = 0; i < 150; i++) {
        tickAdrenaline(1 / 60, false);
        const s = getPlayerSpeed();
        if (s < minSpeed) minSpeed = s;
      }
    }

    expect(minSpeed).toBeGreaterThan(0);
  });

  it('rapid kill streaks do not stack speed boosts', () => {
    skills.activeEffects.add('speed_on_kill');

    // Multiple kills in rapid succession
    tickAdrenaline(1 / 60, true);
    tickAdrenaline(1 / 60, true);
    tickAdrenaline(1 / 60, true);

    // Should only have +54 once, not +162
    expect(getPlayerSpeed()).toBeCloseTo(BASE_SPEED + 54);
  });

  it('kill during active adrenaline refreshes timer without extra speed', () => {
    skills.activeEffects.add('speed_on_kill');

    tickAdrenaline(1 / 60, true);
    expect(getPlayerSpeed()).toBeCloseTo(BASE_SPEED + 54);

    // Wait 1.5s then kill again (adrenaline still active)
    for (let i = 0; i < 90; i++) tickAdrenaline(1 / 60, false);
    tickAdrenaline(1 / 60, true); // refresh
    expect(getPlayerSpeed()).toBeCloseTo(BASE_SPEED + 54);

    // Wait another 2.5s for full expire
    for (let i = 0; i < 150; i++) tickAdrenaline(1 / 60, false);
    expect(getPlayerSpeed()).toBeCloseTo(BASE_SPEED);
  });
});
