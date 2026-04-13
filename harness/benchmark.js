/**
 * Benchmark harness.
 * Runs standardized scenarios at different enemy counts and reports timing.
 *
 * Usage: node harness/benchmark.js
 */

import { loadEngine } from '../src/engine/loader.js';
import { EngineBindings, TYPE } from '../src/engine/bindings.js';

const SCENARIOS = [
  { name: '100 enemies', enemies: 100, ticks: 300 },
  { name: '500 enemies', enemies: 500, ticks: 300 },
  { name: '1000 enemies', enemies: 1000, ticks: 300 },
  { name: '2000 enemies', enemies: 2000, ticks: 200 },
];

const DT = 1 / 60;
const WORLD = 4096;

async function runBenchmark() {
  console.log('========================================');
  console.log('  LUMINANT BENCHMARK');
  console.log('========================================\n');

  const wasm = await loadEngine();

  for (const scenario of SCENARIOS) {
    const engine = new EngineBindings(wasm);
    engine.init(WORLD, WORLD);

    // Spawn player
    const pid = engine.spawnEntity(TYPE.PLAYER, WORLD / 2, WORLD / 2, 9999, 180, 12, 0, 0);
    engine.setPlayerId(pid);
    engine.setPlayerInput(0.3, 0.2, 0);

    // Spawn enemies
    let spawned = 0;
    for (let i = 0; i < scenario.enemies; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 200 + Math.random() * 800;
      const x = WORLD / 2 + Math.cos(angle) * dist;
      const y = WORLD / 2 + Math.sin(angle) * dist;
      const id = engine.spawnEntity(TYPE.ENEMY_BASIC, x, y, 30, 60, 10, 8, 10);
      if (id >= 0) spawned++;
    }

    // Warm up
    for (let i = 0; i < 10; i++) engine.step(DT);

    // Benchmark
    const times = [];
    for (let i = 0; i < scenario.ticks; i++) {
      const t0 = performance.now();
      engine.step(DT);
      times.push(performance.now() - t0);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const sorted = [...times].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];

    const budget60 = 16.67;
    const headroom = ((budget60 - avg) / budget60 * 100).toFixed(1);

    console.log(`--- ${scenario.name} (${spawned} spawned, ${scenario.ticks} ticks) ---`);
    console.log(`  Avg:  ${avg.toFixed(3)} ms`);
    console.log(`  Min:  ${min.toFixed(3)} ms`);
    console.log(`  P50:  ${p50.toFixed(3)} ms`);
    console.log(`  P95:  ${p95.toFixed(3)} ms`);
    console.log(`  P99:  ${p99.toFixed(3)} ms`);
    console.log(`  Max:  ${max.toFixed(3)} ms`);
    console.log(`  60fps headroom: ${headroom}%`);
    console.log('');
  }

  console.log('========================================');
  console.log('  DONE');
  console.log('========================================');
}

runBenchmark().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
