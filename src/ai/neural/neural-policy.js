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

// Load trained weights at module load time.
// In browser/Vite: use fetch with import.meta.url resolution.
// In Node (workers/tests): use fs.readFileSync.
let TRAINED_WEIGHTS = null;
try {
  if (typeof globalThis.document !== 'undefined') {
    // Browser — resolve relative to this module's URL
    const url = new URL('./trained-weights.json', import.meta.url).href;
    const resp = await fetch(url);
    if (resp.ok) TRAINED_WEIGHTS = await resp.json();
  } else {
    // Node
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { dirname, resolve } = await import('path');
    const dir = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(resolve(dir, 'trained-weights.json'), 'utf-8');
    TRAINED_WEIGHTS = JSON.parse(raw);
  }
} catch {
  // No trained weights available — will use zeros or caller-provided weights
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
  const inputBuf = new Float32Array(INPUT_SIZE);

  return {
    name: 'Neural',
    id: 'neural',
    params: { topology: net.topology, weightCount: net.weightCount },

    reset() {
      sensors.reset();
    },

    act(obs) {
      const sensorData = sensors.sense(obs);
      encodeObservation(sensorData, inputBuf);

      const out = net.forward(inputBuf);

      // Map outputs to actions
      const dx = tanh(out[0]);
      const dy = tanh(out[1]);
      const attack = sigmoid(out[2]) > 0.5;
      const aimOffset = tanh(out[3]) * Math.PI;

      // Aim toward nearest enemy + learned offset
      const aimAngle = (sensorData.nearestEnemyAngle || 0) + aimOffset;
      const range = sensorData.weaponRange || 100;
      const targetX = obs.playerX + Math.cos(aimAngle) * range;
      const targetY = obs.playerY + Math.sin(aimAngle) * range;

      return { dx, dy, attack, targetX, targetY };
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
