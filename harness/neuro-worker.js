/**
 * Worker thread for neuroevolution training.
 * Receives genome + seeds, runs N headless games, returns average fitness.
 * Includes a responsiveness penalty to prevent constant-output degenerate strategies.
 */

import { parentPort } from 'worker_threads';
import { loadEngine } from '../src/engine/loader.js';
import { runGameWithBehavior } from '../src/ai/game-runner.js';
import { FeedforwardNetwork } from '../src/ai/neural/feedforward.js';
import { INPUT_SIZE, encodeObservation } from '../src/ai/neural/encode.js';

// Register neural policy
import '../src/ai/neural/neural-policy.js';
// Register brawler for upgrade strategy dependencies
import '../src/systems/player-ai/policies/brawler.js';

let wasm = null;

/**
 * Probe the network with varied inputs and measure output variance.
 * Returns a penalty (negative) if outputs barely change across different situations.
 */
function responsivenessCheck(genome) {
  const net = new FeedforwardNetwork([INPUT_SIZE, 32, 16, 4]);
  net.setWeights(new Float32Array(genome));

  const probes = [
    // Safe, no enemies
    { hpRatio: 1, weaponReady: true, nearEnemyCount: 0, midEnemyCount: 0, farEnemyCount: 0,
      nearestEnemyDist: 500, nearestEnemyAngle: 0, distToEdge: 2000, encirclement: 0, localThreat: 0 },
    // Surrounded, low HP
    { hpRatio: 0.15, weaponReady: true, nearEnemyCount: 10, midEnemyCount: 20, farEnemyCount: 40,
      nearestEnemyDist: 30, nearestEnemyAngle: 1.5, distToEdge: 1500, encirclement: 0.9, localThreat: 8 },
    // Enemy behind, near wall
    { hpRatio: 0.6, weaponReady: false, nearEnemyCount: 3, midEnemyCount: 6, farEnemyCount: 10,
      nearestEnemyDist: 120, nearestEnemyAngle: Math.PI, distToEdge: 40, encirclement: 0.25, localThreat: 3 },
    // Enemies left, pickup right
    { hpRatio: 0.8, weaponReady: true, nearEnemyCount: 5, midEnemyCount: 8, farEnemyCount: 15,
      nearestEnemyDist: 60, nearestEnemyAngle: -1.5, distToEdge: 800, encirclement: 0.5, localThreat: 5 },
  ];

  const outputs = probes.map(p => {
    const obs = {
      ...p,
      weaponCooldownRatio: p.weaponReady ? 0 : 0.7,
      weaponRange: 80, enemiesInArc: Math.min(p.nearEnemyCount, 5),
      sectorDensity: [0,0,0,0,0,0,0,0], sectorThreat: [0,0,0,0,0,0,0,0],
      nearestPickupDist: 300, nearestPickupAngle: 1, recentDamageTaken: 0,
      playerMaxHP: 100, gameTime: 60, totalEnemies: p.farEnemyCount,
      safestDirX: 0, safestDirY: 1, preferredRange: 80,
      dirDanger: [10,10,10,10,10,10,10,10], dirReward: [1,1,1,1,1,1,1,1],
      playerX: 2048, playerY: 2048,
    };
    // Fill in sector data based on enemy counts
    if (p.nearEnemyCount > 0) {
      const sector = Math.floor(((p.nearestEnemyAngle + Math.PI) / (Math.PI * 2)) * 8) % 8;
      obs.sectorDensity[sector] = p.nearEnemyCount;
      obs.sectorThreat[sector] = p.nearEnemyCount * 50;
      obs.dirDanger[sector] = p.nearEnemyCount * 20;
    }
    const encoded = encodeObservation(obs);
    return net.forward(encoded);
  });

  // Measure variance of dx and dy outputs across probes
  let dxVariance = 0, dyVariance = 0;
  const dxMean = outputs.reduce((s, o) => s + Math.tanh(o[0]), 0) / outputs.length;
  const dyMean = outputs.reduce((s, o) => s + Math.tanh(o[1]), 0) / outputs.length;
  for (const o of outputs) {
    dxVariance += (Math.tanh(o[0]) - dxMean) ** 2;
    dyVariance += (Math.tanh(o[1]) - dyMean) ** 2;
  }
  dxVariance /= outputs.length;
  dyVariance /= outputs.length;

  // Total movement variance — if near zero, the network outputs the same direction always
  const totalVariance = dxVariance + dyVariance;

  // Penalty: if variance < 0.01, heavily penalize. Scale: 0 variance = -500 penalty.
  if (totalVariance < 0.01) return -500;
  if (totalVariance < 0.05) return -200 * (0.05 - totalVariance) / 0.05;
  return 0;
}

/**
 * Compute behavior quality bonus/penalty from tracked behavioral metrics.
 * Rewards smooth, human-like play. Penalizes jitter, corner-hugging, wasteful attacks.
 */
function behaviorScore(behavior, maxTicks) {
  let bonus = 0;
  const totalTicks = behavior.totalTicks || 1;

  // ── Jitter penalty: direction reversals per tick ──
  // A human changes direction ~0.02 times/tick. Above 0.1 looks spastic.
  const reversalRate = (behavior.directionReversals || 0) / totalTicks;
  if (reversalRate > 0.1) {
    bonus -= (reversalRate - 0.1) * 2000; // heavy penalty for extreme jitter
  } else if (reversalRate < 0.04) {
    bonus += 50; // small reward for smooth movement
  }

  // ── Corner time penalty: fraction of time near walls ──
  // Piecewise: small linear penalty above 10%, steep penalty above 25%.
  // Previous (threshold 30%, factor 800) allowed the network to spend
  // ~half the game hugging walls with negligible fitness cost.
  const cornerFrac = (behavior.wallFrames || 0) / totalTicks;
  if (cornerFrac > 0.1) {
    bonus -= (cornerFrac - 0.1) * 2500;
  }
  if (cornerFrac > 0.25) {
    bonus -= (cornerFrac - 0.25) * 3500;
  }

  // ── Wasteful attack penalty: attacks that hit nothing ──
  const totalAttacks = behavior.totalAttacks || 1;
  const wastedAttacks = behavior.wastedAttacks || 0;
  const wasteRate = wastedAttacks / totalAttacks;
  if (wasteRate > 0.5) {
    bonus -= (wasteRate - 0.5) * 300; // penalize >50% miss rate
  }

  // ── Stuck penalty: consecutive frames near-zero movement ──
  const maxStuckStreak = behavior.maxStuckStreak || 0;
  if (maxStuckStreak > 60) { // stuck for 1+ seconds
    bonus -= Math.min(maxStuckStreak - 60, 300) * 2;
  }

  // ── Center-of-arena bonus: reward staying toward middle ──
  const avgCenterDist = behavior.avgCenterDist || 0; // 0-1 normalized, 0=center
  if (avgCenterDist < 0.3) {
    bonus += 30; // small reward for staying centeredish
  }

  return bonus;
}

parentPort.on('message', async (msg) => {
  if (msg.type === 'init') {
    wasm = await loadEngine();
    parentPort.postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'evaluate') {
    const { genome, seeds, maxTicks, id } = msg;

    try {
      const { createPolicy } = await import('../src/ai/policy-types.js');
      const policy = createPolicy('neural', {
        weights: new Float32Array(genome),
      });

      let totalScore = 0;
      let totalBehaviorBonus = 0;
      for (const seed of seeds) {
        const result = await runGameWithBehavior({
          policy,
          seed,
          maxTicks,
          wasm,
          silent: true,
        });
        totalScore += result.score;
        if (result.behavior) {
          totalBehaviorBonus += behaviorScore(result.behavior, maxTicks);
        }
      }

      const avgScore = totalScore / seeds.length;
      const avgBehavior = totalBehaviorBonus / seeds.length;
      const penalty = responsivenessCheck(genome);
      parentPort.postMessage({ type: 'result', id, fitness: avgScore + avgBehavior + penalty });
    } catch (err) {
      parentPort.postMessage({ type: 'error', id, error: err.message });
    }
  }
});
