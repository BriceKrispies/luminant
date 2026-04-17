/**
 * Mass-death benchmark.
 * Reproduces the framerate drop when many enemies die simultaneously.
 * Profiles each stage of the JS-side pipeline separately.
 *
 * Usage: node harness/mass-death-bench.js [--enemies=50] [--shockwave]
 */

import { loadEngine } from '../src/engine/loader.js';
import { EngineBindings, TYPE, STATE, FIELD } from '../src/engine/bindings.js';
import { createXPSystem } from '../src/systems/xp.js';
import { createWeaponSystem } from '../src/systems/weapons.js';
import { createFeedbackSystem } from '../src/systems/feedback.js';
import { createSkillSystem } from '../src/systems/skills.js';
import { createPlayerSystem } from '../src/systems/player.js';
import { addEffect, updateEffects, clearEffects } from '../src/renderer/effects.js';

const args = parseArgs(process.argv.slice(2));
const BATCH_SIZES = [10, 25, 50, 100, 200];
const WORLD = 4096;
const DT = 1 / 60;
const WARMUP = 3;
const TRIALS = 10;

// Stub camera/clock for feedback system (no real rendering)
const stubCamera = {
  x: WORLD / 2, y: WORLD / 2,
  addShake() {},
  addImpulse() {},
};
const stubClock = { addFreeze() {} };

async function run() {
  console.log('==========================================');
  console.log('  MASS-DEATH BENCHMARK');
  console.log('==========================================\n');

  const wasm = await loadEngine();

  for (const batchSize of BATCH_SIZES) {
    const results = { total: [], step: [], xpProcess: [], feedback: [], effects: [], spawn: [] };

    for (let trial = -WARMUP; trial < TRIALS; trial++) {
      const engine = new EngineBindings(wasm);
      engine.init(WORLD, WORLD);
      clearEffects();

      const player = createPlayerSystem(engine);
      const feedback = createFeedbackSystem(engine, { camera: stubCamera, clock: stubClock });
      const weapons = createWeaponSystem(engine, { feedback });
      const xpSystem = createXPSystem(engine, { feedback });
      const skills = createSkillSystem(player, weapons);

      // Enable shockwave if requested — this is likely expensive
      if (args.shockwave) {
        skills.activeEffects.add('kill_shockwave');
      }

      player.spawn(WORLD / 2, WORLD / 2);

      // Spawn a tight cluster of enemies near the player
      for (let i = 0; i < batchSize; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 30 + Math.random() * 40; // tight cluster
        const x = WORLD / 2 + Math.cos(angle) * dist;
        const y = WORLD / 2 + Math.sin(angle) * dist;
        engine.spawnEntity(TYPE.ENEMY_BASIC, x, y, 10, 60, 10, 8, 10);
      }

      // Step once to build grid
      engine.step(DT);

      // Kill all enemies at once (simulating a big AoE or shockwave chain)
      engine.forEachEntity((id, type, state) => {
        if (type >= 2 && type <= 13 && state === STATE.ACTIVE) {
          engine.applyDamage(id, 9999);
        }
      });

      // Now engine.step will set them to DYING via process_deaths
      const tStep0 = performance.now();
      engine.step(DT);
      const tStep1 = performance.now();

      // XP processing: despawn dying, spawn pickups, run shockwaves
      const tXp0 = performance.now();
      xpSystem.processDyingEntities(skills, player);
      const tXp1 = performance.now();

      // Feedback: process queued events
      const tFb0 = performance.now();
      feedback.update(DT);
      const tFb1 = performance.now();

      // Effects: update all active visual effects
      const tFx0 = performance.now();
      updateEffects(DT);
      const tFx1 = performance.now();

      const total = tFx1 - tStep0;

      if (trial >= 0) {
        results.step.push(tStep1 - tStep0);
        results.xpProcess.push(tXp1 - tXp0);
        results.feedback.push(tFb1 - tFb0);
        results.effects.push(tFx1 - tFx0);
        results.total.push(total);
      }
    }

    const fmt = (arr) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      return `avg=${avg.toFixed(3)}ms  p95=${p95.toFixed(3)}ms`;
    };

    console.log(`--- ${batchSize} simultaneous deaths${args.shockwave ? ' +shockwave' : ''} ---`);
    console.log(`  Total:       ${fmt(results.total)}`);
    console.log(`  engine.step: ${fmt(results.step)}`);
    console.log(`  xpProcess:   ${fmt(results.xpProcess)}`);
    console.log(`  feedback:    ${fmt(results.feedback)}`);
    console.log(`  effects:     ${fmt(results.effects)}`);

    const avgTotal = results.total.reduce((a, b) => a + b, 0) / results.total.length;
    const budget = 16.67;
    const pct = ((avgTotal / budget) * 100).toFixed(1);
    console.log(`  Frame budget: ${pct}% of 16.67ms`);
    console.log('');
  }

  // Now run the shockwave variant if we haven't already
  if (!args.shockwave) {
    console.log('(re-run with --shockwave to include kill_shockwave effect)\n');
  }

  console.log('==========================================');
  console.log('  DONE');
  console.log('==========================================');
}

function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if (arg === '--shockwave') { result.shockwave = true; continue; }
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (m) result[m[1]] = parseFloat(m[2]) || m[2];
  }
  return result;
}

run().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
