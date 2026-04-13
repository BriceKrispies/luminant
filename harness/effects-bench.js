/**
 * Effects rendering benchmark.
 * Measures the cost of drawing many simultaneous visual effects.
 * This isolates the renderer path — the likely bottleneck for mass deaths.
 *
 * Usage: node harness/effects-bench.js
 */

import { addEffect, updateEffects, drawEffects, clearEffects } from '../src/renderer/effects.js';

const BATCH_SIZES = [10, 25, 50, 100, 200, 400];
const TRIALS = 20;
const WARMUP = 3;

// Check if we can get a canvas context (need a shim or skip draw test)
let ctx = null;
try {
  // Try to create an OffscreenCanvas (Node 20+)
  const c = new OffscreenCanvas(1280, 720);
  ctx = c.getContext('2d');
} catch {
  // OffscreenCanvas not available — measure addEffect + updateEffects only
}

function run() {
  console.log('==========================================');
  console.log('  EFFECTS RENDERING BENCHMARK');
  console.log('==========================================');
  if (!ctx) {
    console.log('  (no OffscreenCanvas — draw costs estimated only)\n');
  }
  console.log('');

  for (const batchSize of BATCH_SIZES) {
    const addTimes = [];
    const updateTimes = [];
    const drawTimes = [];

    for (let trial = -WARMUP; trial < TRIALS; trial++) {
      clearEffects();

      // Simulate mass death: add batchSize death effects + batchSize hit effects
      const tAdd0 = performance.now();
      for (let i = 0; i < batchSize; i++) {
        const x = 640 + (Math.random() - 0.5) * 200;
        const y = 360 + (Math.random() - 0.5) * 200;
        const mag = 1 + Math.log2(batchSize);
        addEffect('death', x, y, { duration: 0.35, magnitude: mag });
        // Feedback also emits hit effects for shockwaves
        addEffect('hit', x, y, { duration: 0.2, magnitude: 25 });
      }
      const tAdd1 = performance.now();

      // Simulate a few frames of updates + draws
      let worstUpdate = 0;
      let worstDraw = 0;
      for (let frame = 0; frame < 10; frame++) {
        const tU0 = performance.now();
        updateEffects(1 / 60);
        const tU1 = performance.now();
        if (tU1 - tU0 > worstUpdate) worstUpdate = tU1 - tU0;

        if (ctx) {
          ctx.clearRect(0, 0, 1280, 720);
          const tD0 = performance.now();
          drawEffects(ctx, null, null);
          const tD1 = performance.now();
          if (tD1 - tD0 > worstDraw) worstDraw = tD1 - tD0;
        }
      }

      if (trial >= 0) {
        addTimes.push(tAdd1 - tAdd0);
        updateTimes.push(worstUpdate);
        if (ctx) drawTimes.push(worstDraw);
      }
    }

    const fmt = (arr) => {
      if (arr.length === 0) return 'N/A';
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      const sorted = [...arr].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      return `avg=${avg.toFixed(3)}ms  p95=${p95.toFixed(3)}ms`;
    };

    // Count total effects
    const totalEffects = batchSize * 2; // death + hit per enemy

    console.log(`--- ${batchSize} deaths (${totalEffects} effects) ---`);
    console.log(`  addEffect:    ${fmt(addTimes)}`);
    console.log(`  updateEffects (worst frame): ${fmt(updateTimes)}`);
    if (ctx) {
      console.log(`  drawEffects (worst frame):   ${fmt(drawTimes)}`);
    }

    // Estimate: each death effect does createRadialGradient, each hit does arc+fill
    // On a real GPU-backed canvas this is ~0.01-0.05ms per gradient
    if (!ctx) {
      const estDrawMs = totalEffects * 0.03;
      console.log(`  drawEffects (estimated):     ~${estDrawMs.toFixed(1)}ms (${totalEffects} effects × ~0.03ms)`);
    }
    console.log('');
  }

  console.log('==========================================');
  console.log('  ANALYSIS');
  console.log('==========================================');
  console.log('');
  console.log('Key observations:');
  console.log('  - Each death creates 2 effects: death (radialGradient) + hit (arc)');
  console.log('  - Death effects last 0.35s = ~21 frames of drawing');
  console.log('  - At 200 deaths: 400 effects × 21 frames of radialGradient calls');
  console.log('  - createRadialGradient is expensive on software-rendered canvas');
  console.log('');
  console.log('Likely fixes:');
  console.log('  1. Cap max simultaneous death effects (e.g., 30)');
  console.log('  2. Merge nearby deaths into a single larger effect');
  console.log('  3. Replace radialGradient with simpler circle fill for small deaths');
  console.log('  4. Reduce death effect duration when many are active');
  console.log('');
}

run();
