/**
 * Observation encoder for neural network input.
 * Maps sensor-enriched observation to a normalized Float32Array.
 *
 * Uses the sensor layer from player-ai/sensors.js which computes
 * encirclement, dirDanger, dirReward, localThreat, preferredRange, etc.
 */

/** Total input size for the neural network */
export const INPUT_SIZE = 53;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Encode a sensor-enriched observation into a normalized float vector.
 * @param {Object} sensorObs — output of sensors.sense(obs)
 * @param {Float32Array} [out] — optional pre-allocated buffer
 * @returns {Float32Array} — INPUT_SIZE floats, all roughly in [0,1] or [-1,1]
 */
export function encodeObservation(sensorObs, out) {
  const buf = out || new Float32Array(INPUT_SIZE);
  let idx = 0;

  // Scalar features (1 each)
  buf[idx++] = clamp(sensorObs.hpRatio, 0, 1);                          // 0
  buf[idx++] = sensorObs.weaponReady ? 1 : 0;                           // 1
  buf[idx++] = clamp(sensorObs.weaponCooldownRatio || 0, 0, 1);         // 2
  buf[idx++] = clamp((sensorObs.weaponRange || 100) / 500, 0, 2);       // 3
  buf[idx++] = clamp((sensorObs.enemiesInArc || 0) / 10, 0, 1);         // 4

  // Enemy counts by range (3)
  buf[idx++] = clamp(sensorObs.nearEnemyCount / 15, 0, 1);              // 5
  buf[idx++] = clamp(sensorObs.midEnemyCount / 30, 0, 1);               // 6
  buf[idx++] = clamp(sensorObs.farEnemyCount / 50, 0, 1);               // 7

  // Sector density (8)
  for (let i = 0; i < 8; i++) {
    buf[idx++] = clamp(sensorObs.sectorDensity[i] / 10, 0, 1);          // 8-15
  }

  // Sector threat (8)
  for (let i = 0; i < 8; i++) {
    buf[idx++] = clamp(sensorObs.sectorThreat[i] / 500, 0, 1);          // 16-23
  }

  // Nearest enemy (2)
  buf[idx++] = clamp(sensorObs.nearestEnemyDist / 500, 0, 1);           // 24
  buf[idx++] = (sensorObs.nearestEnemyAngle || 0) / Math.PI;            // 25

  // Nearest pickup (2)
  buf[idx++] = clamp(sensorObs.nearestPickupDist / 500, 0, 1);          // 26
  buf[idx++] = (sensorObs.nearestPickupAngle || 0) / Math.PI;           // 27

  // Damage, time, enemies, edge (4)
  buf[idx++] = clamp(sensorObs.recentDamageTaken / (sensorObs.playerMaxHP || 100), 0, 1); // 28
  buf[idx++] = clamp((sensorObs.gameTime || 0) / 600, 0, 1);            // 29
  buf[idx++] = clamp(sensorObs.totalEnemies / 100, 0, 1);               // 30
  buf[idx++] = clamp(sensorObs.distToEdge / 500, 0, 1);                 // 31

  // Safest direction (2)
  buf[idx++] = sensorObs.safestDirX || 0;                                // 32
  buf[idx++] = sensorObs.safestDirY || 0;                                // 33

  // Sensor-enriched features (3)
  buf[idx++] = clamp(sensorObs.encirclement || 0, 0, 1);                 // 34
  buf[idx++] = clamp((sensorObs.localThreat || 0) / 10, 0, 1);          // 35
  buf[idx++] = clamp((sensorObs.preferredRange || 100) / 500, 0, 1);    // 36

  // Directional danger (8)
  for (let i = 0; i < 8; i++) {
    buf[idx++] = clamp((sensorObs.dirDanger?.[i] || 0) / 100, 0, 1);    // 37-44
  }

  // Directional reward (8)
  for (let i = 0; i < 8; i++) {
    buf[idx++] = clamp((sensorObs.dirReward?.[i] || 0) / 5, 0, 1);      // 45-52
  }

  return buf;
}
