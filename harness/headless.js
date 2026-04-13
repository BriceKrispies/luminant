/**
 * Headless simulation harness.
 * Runs the simulation without rendering, prints metrics to stdout.
 *
 * Usage: node harness/headless.js [--enemies=100] [--ticks=600] [--dt=0.016]
 */

import { loadEngine } from '../src/engine/loader.js';
import { EngineBindings, TYPE, STATE, MAX_ENTITIES, ENTITY_STRIDE, FIELD } from '../src/engine/bindings.js';

const args = parseArgs(process.argv.slice(2));
const ENEMY_COUNT = args.enemies || 200;
const TICKS = args.ticks || 600;
const DT = args.dt || 1 / 60;
const WORLD_W = 4096;
const WORLD_H = 4096;

async function run() {
  console.log(`[headless] Loading engine...`);
  const wasm = await loadEngine();
  const engine = new EngineBindings(wasm);

  console.log(`[headless] Initializing world ${WORLD_W}x${WORLD_H}`);
  engine.init(WORLD_W, WORLD_H);

  // Spawn player at center
  const playerId = engine.spawnEntity(TYPE.PLAYER, WORLD_W / 2, WORLD_H / 2, 100, 180, 12, 0, 0);
  engine.setPlayerId(playerId);
  console.log(`[headless] Player spawned at (${WORLD_W / 2}, ${WORLD_H / 2})`);

  // Spawn enemies around the player
  console.log(`[headless] Spawning ${ENEMY_COUNT} enemies...`);
  let spawned = 0;
  for (let i = 0; i < ENEMY_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 300 + Math.random() * 500;
    const x = WORLD_W / 2 + Math.cos(angle) * dist;
    const y = WORLD_H / 2 + Math.sin(angle) * dist;
    const types = [TYPE.ENEMY_BASIC, TYPE.ENEMY_FAST, TYPE.ENEMY_TANK];
    const type = types[Math.floor(Math.random() * types.length)];
    const hp = type === TYPE.ENEMY_TANK ? 120 : type === TYPE.ENEMY_FAST ? 15 : 30;
    const speed = type === TYPE.ENEMY_TANK ? 35 : type === TYPE.ENEMY_FAST ? 120 : 60;
    const radius = type === TYPE.ENEMY_TANK ? 16 : type === TYPE.ENEMY_FAST ? 7 : 10;
    const id = engine.spawnEntity(type, x, y, hp, speed, radius, 8, 10);
    if (id >= 0) spawned++;
  }
  console.log(`[headless] Spawned ${spawned} enemies`);

  // Set player moving to keep things dynamic
  engine.setPlayerInput(0.5, 0.3, 0);

  // Run simulation
  console.log(`[headless] Running ${TICKS} ticks at dt=${DT}...`);
  const times = [];
  const start = performance.now();

  for (let tick = 0; tick < TICKS; tick++) {
    const t0 = performance.now();
    engine.step(DT);
    const t1 = performance.now();
    times.push(t1 - t0);

    // Periodically spawn a projectile to test combat
    if (tick % 10 === 0) {
      const px = engine.getEntityX(playerId);
      const py = engine.getEntityY(playerId);
      const projId = engine.spawnEntity(TYPE.PROJECTILE_BULLET, px, py, 1, 500, 4, 15, 0);
      if (projId >= 0) {
        const angle = Math.random() * Math.PI * 2;
        engine.setEntityVelocity(projId, Math.cos(angle) * 500, Math.sin(angle) * 500);
        engine.setEntityLifetime(projId, 1.5);
      }
    }

    // Print progress every 100 ticks
    if ((tick + 1) % 100 === 0) {
      const metrics = engine.getMetrics();
      console.log(`  Tick ${tick + 1}: active=${metrics.activeEntities} avg=${avg(times.slice(-100)).toFixed(3)}ms`);
    }
  }

  const totalMs = performance.now() - start;
  const metrics = engine.getMetrics();

  console.log(`\n[headless] Results:`);
  console.log(`  Total time:    ${totalMs.toFixed(1)} ms`);
  console.log(`  Avg step:      ${avg(times).toFixed(3)} ms`);
  console.log(`  Min step:      ${Math.min(...times).toFixed(3)} ms`);
  console.log(`  Max step:      ${Math.max(...times).toFixed(3)} ms`);
  console.log(`  P95 step:      ${percentile(times, 0.95).toFixed(3)} ms`);
  console.log(`  P99 step:      ${percentile(times, 0.99).toFixed(3)} ms`);
  console.log(`  Active:        ${metrics.activeEntities}`);
  console.log(`  Sim time:      ${engine.getTime().toFixed(2)}s`);
}

function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p)];
}

function parseArgs(args) {
  const result = {};
  for (const arg of args) {
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (m) result[m[1]] = parseFloat(m[2]) || m[2];
  }
  return result;
}

run().catch(err => {
  console.error('[headless] FATAL:', err);
  process.exit(1);
});
