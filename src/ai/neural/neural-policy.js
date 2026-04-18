/**
 * Neural network policy — drop-in replacement for utility-based policies.
 * Uses feedforward network for movement/attack decisions,
 * and brawler's upgrade strategy for level-up choices.
 */

import { registerPolicy } from '../../ai/policy-types.js';
import { createSensors } from '../../systems/player-ai/sensors.js';
import { createUpgradeStrategy } from '../../systems/player-ai/upgrade-strategy.js';
import { FeedforwardNetwork } from './feedforward.js';
import { INPUT_SIZE, encodeObservation } from './encode.js';
import { createNeuralDiagnostics } from './neural-diagnostics.js';

// Load trained weights at module load time.
// Browser: fetch with import.meta.url resolution.
// Node (workers/tests): fs.readFileSync.
let TRAINED_WEIGHTS = null;
try {
  if (typeof process !== 'undefined' && process.versions?.node && typeof globalThis.document === 'undefined') {
    // Node (workers/harnesses)
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { dirname, resolve } = await import('path');
    const dir = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(resolve(dir, 'trained-weights.json'), 'utf-8');
    TRAINED_WEIGHTS = JSON.parse(raw);
  } else {
    // Browser — resolve relative to this module's URL
    const url = new URL('./trained-weights.json', import.meta.url).href;
    const resp = await fetch(url, { cache: 'no-cache' });
    if (resp.ok) TRAINED_WEIGHTS = await resp.json();
  }
  if (TRAINED_WEIGHTS) {
    console.log(`[neural] Loaded weights: fitness=${TRAINED_WEIGHTS.fitness?.toFixed(0)} timestamp=${TRAINED_WEIGHTS.timestamp} topology=${JSON.stringify(TRAINED_WEIGHTS.topology)}`);
  }
} catch (e) {
  console.warn('[neural] Failed to load trained weights:', e?.message || e);
}

const DEFAULT_TOPOLOGY = [INPUT_SIZE, 32, 16, 4];

// Brawler upgrade weights — reused since upgrade decisions are rare and the heuristic is good
const BRAWLER_UPGRADE_WEIGHTS = {
  upgradeWeights: {
    survivability: 1.5,
    damage: 2.0,
    aoe: 1.8,
    speed: 0.5,
    utility: 0.5,
    scaling: 1.5,
  },
  clusterPreference: 0.8,
  survivalBias: 0.2,
  kite: 0.3,
};

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function tanh(x) {
  return Math.tanh(x);
}

// ── Smoothing constants ──
const MOVE_SMOOTH = 0.25;          // EMA factor — lower = smoother (0.25 blends 25% new, 75% old)
const COMMIT_FRAMES = 6;           // minimum frames before allowing sharp direction reversal
const REVERSAL_THRESHOLD = -0.5;   // dot product below this = sharp reversal
const AIM_OFFSET_SCALE = Math.PI / 4; // max ±45° aim offset (was full PI)
const ATTACK_RANGE_GATE = 1.3;     // only attack if nearest enemy < weaponRange * this
const WALL_REPEL_DIST = 120;       // start pushing away from walls at this distance
const WALL_REPEL_STRENGTH = 0.6;   // how much wall repulsion overrides network output

/**
 * Create a neural policy.
 * @param {Object} params
 * @param {Float32Array|number[]} [params.weights] — flat weight array
 * @param {Object} [params.json] — serialized network { topology, weights }
 * @param {number[]} [params.topology] — network topology (default: [53, 32, 16, 4])
 */
function createNeuralPolicy(params = {}) {
  // Priority: explicit params.json > explicit params.weights > auto-loaded trained weights
  const hasTrainedWeights = TRAINED_WEIGHTS && TRAINED_WEIGHTS.weights && TRAINED_WEIGHTS.weights.length > 0;
  if (!params.json && !params.weights && !hasTrainedWeights) {
    console.warn('[neural] No trained weights available — network will output zeros. Run npm run train first.');
  }
  const source = params.json || (params.weights ? null : (hasTrainedWeights ? TRAINED_WEIGHTS : null));
  const topology = params.topology || (source?.topology) || DEFAULT_TOPOLOGY;
  const net = source
    ? FeedforwardNetwork.fromJSON(source)
    : new FeedforwardNetwork(topology);

  if (params.weights) {
    net.setWeights(
      params.weights instanceof Float32Array
        ? params.weights
        : new Float32Array(params.weights)
    );
  }

  const sensors = createSensors();
  const upgrader = createUpgradeStrategy(BRAWLER_UPGRADE_WEIGHTS);
  const diagnostics = createNeuralDiagnostics();
  const inputBuf = new Float32Array(INPUT_SIZE);

  // Smoothing state
  let smoothDx = 0;
  let smoothDy = 0;
  let commitCounter = 0;   // frames since last direction commitment

  return {
    name: 'Neural',
    id: 'neural',
    params: { topology: net.topology, weightCount: net.weightCount },

    reset() {
      sensors.reset();
      diagnostics.reset();
      smoothDx = 0;
      smoothDy = 0;
      commitCounter = 0;
    },

    act(obs) {
      const sensorData = sensors.sense(obs);
      encodeObservation(sensorData, inputBuf);

      const out = net.forward(inputBuf);

      // ── Raw network outputs ──
      let rawDx = tanh(out[0]);
      let rawDy = tanh(out[1]);
      const attackSignal = sigmoid(out[2]);
      const aimOffset = tanh(out[3]) * AIM_OFFSET_SCALE;

      // ── Wall repulsion ──
      // Push away from edges so the AI doesn't corner itself
      const worldW = obs.worldW || 4096;
      const worldH = obs.worldH || 4096;
      const px = obs.playerX;
      const py = obs.playerY;

      if (px < WALL_REPEL_DIST) {
        const t = 1 - px / WALL_REPEL_DIST; // 0 at threshold, 1 at wall
        rawDx += t * WALL_REPEL_STRENGTH;
      } else if (px > worldW - WALL_REPEL_DIST) {
        const t = 1 - (worldW - px) / WALL_REPEL_DIST;
        rawDx -= t * WALL_REPEL_STRENGTH;
      }
      if (py < WALL_REPEL_DIST) {
        const t = 1 - py / WALL_REPEL_DIST;
        rawDy += t * WALL_REPEL_STRENGTH;
      } else if (py > worldH - WALL_REPEL_DIST) {
        const t = 1 - (worldH - py) / WALL_REPEL_DIST;
        rawDy -= t * WALL_REPEL_STRENGTH;
      }

      // ── Movement smoothing (EMA + commitment) ──
      // Check for sharp reversals — if committed to a direction, resist flipping
      const dot = rawDx * smoothDx + rawDy * smoothDy;
      commitCounter++;

      let targetDx, targetDy;
      if (commitCounter < COMMIT_FRAMES && dot < REVERSAL_THRESHOLD) {
        // Still committed to previous direction — dampen the reversal
        targetDx = smoothDx;
        targetDy = smoothDy;
      } else {
        targetDx = rawDx;
        targetDy = rawDy;
        if (dot < REVERSAL_THRESHOLD) {
          commitCounter = 0; // reset commitment on accepted reversal
        }
      }

      // Exponential moving average
      smoothDx = smoothDx + MOVE_SMOOTH * (targetDx - smoothDx);
      smoothDy = smoothDy + MOVE_SMOOTH * (targetDy - smoothDy);

      // Normalize if magnitude > 1
      const mag = Math.sqrt(smoothDx * smoothDx + smoothDy * smoothDy);
      const dx = mag > 1 ? smoothDx / mag : smoothDx;
      const dy = mag > 1 ? smoothDy / mag : smoothDy;

      // ── Smart attack gating ──
      // Only attack when weapon is ready AND enemies are actually in range
      const weaponReady = sensorData.weaponReady;
      const nearestDist = sensorData.nearestEnemyDist || Infinity;
      const weaponRange = sensorData.weaponRange || 100;
      const enemiesInRange = nearestDist < weaponRange * ATTACK_RANGE_GATE;
      const attack = attackSignal > 0.5 && weaponReady && enemiesInRange;

      // ── Aim toward nearest enemy + tighter learned offset ──
      const aimAngle = (sensorData.nearestEnemyAngle || 0) + aimOffset;
      const range = weaponRange;
      const targetX = obs.playerX + Math.cos(aimAngle) * range;
      const targetY = obs.playerY + Math.sin(aimAngle) * range;

      const _neuralDebug = diagnostics.classify(sensorData, out, dx, dy, attack);

      return { dx, dy, attack, targetX, targetY, _neuralDebug };
    },

    chooseUpgrade(choices, obs) {
      return upgrader.choose(choices, obs);
    },

    metadata() {
      return { type: 'neural', weightCount: net.weightCount };
    },
  };
}

registerPolicy('neural', createNeuralPolicy);

export { createNeuralPolicy, DEFAULT_TOPOLOGY };
