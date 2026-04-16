/**
 * Neural AI diagnostics — classifies behavior each frame.
 * Distinguishes "stuck" (near-zero output) from "overwhelmed" (too many enemies).
 * Surfaces key metrics for the F3 debug overlay.
 */

// Classification thresholds
const STUCK_MOVE_THRESHOLD = 0.05;
const STUCK_FRAME_THRESHOLD = 10;
const CORNERED_EDGE_DIST = 80;
const CORNERED_ENCIRCLE = 0.5;
const OVERWHELMED_NEAR_ENEMIES = 8;
const OVERWHELMED_DAMAGE_FRAC = 0.2;
const OVERWHELMED_ENCIRCLE = 0.4;
const KITING_MOVE_MIN = 0.3;
const KITING_CLOSING_SPEED = -1;
const DIVING_CLOSING_SPEED = 1;
const IDLE_MOVE_MAX = 0.15;
const IDLE_THREAT_MAX = 1;

export function createNeuralDiagnostics() {
  let stuckFrames = 0;

  return {
    reset() {
      stuckFrames = 0;
    },

    /**
     * Classify current behavior from sensor data and network output.
     * @param {Object} sensorData — enriched observation from sensors.sense()
     * @param {Float32Array} rawOutput — network output before tanh/sigmoid
     * @param {number} dx — post-activation movement x
     * @param {number} dy — post-activation movement y
     * @param {boolean} attack — attack flag
     */
    classify(sensorData, rawOutput, dx, dy, attack) {
      const moveMag = Math.sqrt(dx * dx + dy * dy);

      // Track stuck frames
      if (moveMag < STUCK_MOVE_THRESHOLD) {
        stuckFrames++;
      } else {
        stuckFrames = 0;
      }

      // Extract key inputs for display
      const hpRatio = sensorData.hpRatio || 0;
      const encirclement = sensorData.encirclement || 0;
      const nearestEnemyDist = sensorData.nearestEnemyDist || 0;
      const localThreat = sensorData.localThreat || 0;
      const nearEnemyCount = sensorData.nearEnemyCount || 0;
      const distToEdge = sensorData.distToEdge || 0;
      const recentDamageFrac = sensorData.playerMaxHP
        ? (sensorData.recentDamageTaken || 0) / sensorData.playerMaxHP
        : 0;
      const closingSpeed = sensorData.closingSpeed || 0;

      // Classification (first match wins)
      let state;
      if (distToEdge < CORNERED_EDGE_DIST && encirclement > CORNERED_ENCIRCLE) {
        state = 'cornered';
      } else if ((nearEnemyCount > OVERWHELMED_NEAR_ENEMIES || recentDamageFrac > OVERWHELMED_DAMAGE_FRAC) && encirclement > OVERWHELMED_ENCIRCLE) {
        state = 'overwhelmed';
      } else if (stuckFrames > STUCK_FRAME_THRESHOLD) {
        state = 'stuck';
      } else if (moveMag > KITING_MOVE_MIN && closingSpeed < KITING_CLOSING_SPEED && attack) {
        state = 'kiting';
      } else if (moveMag > KITING_MOVE_MIN && closingSpeed > DIVING_CLOSING_SPEED && attack) {
        state = 'diving';
      } else if (moveMag < IDLE_MOVE_MAX && localThreat < IDLE_THREAT_MAX) {
        state = 'idle';
      } else {
        state = 'active';
      }

      return {
        state,
        stuckFrames,
        moveMag,
        rawOutput,
        keyInputs: {
          hpRatio,
          encirclement,
          nearestEnemyDist,
          localThreat,
          nearEnemyCount,
          distToEdge,
          recentDamageFrac,
          closingSpeed,
        },
      };
    },
  };
}
