/**
 * Observation featurizer for experiment/training architecture.
 *
 * Converts raw observations (from observations.js) + sensor enrichment
 * (from sensors.js) into a stable, normalized feature vector suitable
 * for policy consumption, trajectory recording, and model training.
 *
 * The feature schema is versioned — training artifacts record the schema
 * version so that models trained on older schemas can be detected.
 *
 * Features are all numbers in [0, 1] or [-1, 1] range for neural-net
 * friendliness, with a parallel labels array for human readability.
 */

/** Schema version — bump when feature layout changes */
export const FEATURE_SCHEMA_VERSION = 1;

/** Number of directional slots for sector-based features */
const NUM_DIRS = 8;

/**
 * Feature group definitions.
 * Each group has a name, a list of feature labels, and an extract function
 * that reads from enriched observation and pushes normalized values.
 */
const FEATURE_GROUPS = [
  {
    name: 'health',
    labels: ['hpRatio', 'recentDamageRatio', 'lowHpFlag'],
    extract(obs, out) {
      out.push(clamp01(obs.hpRatio || 0));
      out.push(clamp01((obs.recentDamageTaken || 0) / Math.max(obs.playerMaxHP || 1, 1)));
      out.push(obs.hpRatio < 0.25 ? 1 : 0);
    },
  },
  {
    name: 'enemies',
    labels: ['nearEnemyNorm', 'midEnemyNorm', 'farEnemyNorm', 'totalEnemyNorm', 'nearestEnemyDistNorm'],
    extract(obs, out) {
      out.push(clamp01((obs.nearEnemyCount || 0) / 20));
      out.push(clamp01((obs.midEnemyCount || 0) / 40));
      out.push(clamp01((obs.farEnemyCount || 0) / 60));
      out.push(clamp01((obs.totalEnemies || 0) / 80));
      out.push(clamp01((obs.nearestEnemyDist || 0) / 500));
    },
  },
  {
    name: 'sectorDensity',
    labels: Array.from({ length: NUM_DIRS }, (_, i) => `sectorDensity_${i}`),
    extract(obs, out) {
      const sd = obs.sectorDensity || [];
      for (let i = 0; i < NUM_DIRS; i++) {
        out.push(clamp01((sd[i] || 0) / 10));
      }
    },
  },
  {
    name: 'sectorThreat',
    labels: Array.from({ length: NUM_DIRS }, (_, i) => `sectorThreat_${i}`),
    extract(obs, out) {
      const st = obs.sectorThreat || [];
      const maxT = Math.max(1, ...st);
      for (let i = 0; i < NUM_DIRS; i++) {
        out.push(clamp01((st[i] || 0) / maxT));
      }
    },
  },
  {
    name: 'spatial',
    labels: ['encirclement', 'localThreat', 'closingSpeedNorm', 'distToEdgeNorm'],
    extract(obs, out) {
      out.push(clamp01(obs.encirclement || 0));
      out.push(clamp01((obs.localThreat || 0) / 10));
      out.push(clampN1((obs.closingSpeed || 0) / 10));
      out.push(clamp01((obs.distToEdge || 0) / 500));
    },
  },
  {
    name: 'dirDanger',
    labels: Array.from({ length: NUM_DIRS }, (_, i) => `dirDanger_${i}`),
    extract(obs, out) {
      const dd = obs.dirDanger || [];
      const maxD = Math.max(1, ...dd.map(Math.abs));
      for (let i = 0; i < NUM_DIRS; i++) {
        out.push(clamp01((dd[i] || 0) / maxD));
      }
    },
  },
  {
    name: 'dirReward',
    labels: Array.from({ length: NUM_DIRS }, (_, i) => `dirReward_${i}`),
    extract(obs, out) {
      const dr = obs.dirReward || [];
      const maxR = Math.max(1, ...dr.map(Math.abs));
      for (let i = 0; i < NUM_DIRS; i++) {
        out.push(clamp01((dr[i] || 0) / maxR));
      }
    },
  },
  {
    name: 'weapon',
    labels: ['weaponReady', 'weaponCooldownRatio', 'weaponRangeNorm', 'enemiesInArcNorm'],
    extract(obs, out) {
      out.push(obs.weaponReady ? 1 : 0);
      out.push(clamp01(obs.weaponCooldownRatio || 0));
      out.push(clamp01((obs.weaponRange || 0) / 600));
      out.push(clamp01((obs.enemiesInArc || 0) / 10));
    },
  },
  {
    name: 'pickups',
    labels: ['nearestPickupDistNorm', 'pickupAngleSin', 'pickupAngleCos'],
    extract(obs, out) {
      out.push(clamp01((obs.nearestPickupDist || 500) / 500));
      const pa = obs.nearestPickupAngle || 0;
      out.push(clampN1(Math.sin(pa)));
      out.push(clampN1(Math.cos(pa)));
    },
  },
  {
    name: 'progression',
    labels: ['levelNorm', 'xpRatio', 'waveNorm', 'gameTimeNorm'],
    extract(obs, out) {
      out.push(clamp01((obs.level || 1) / 20));
      out.push(clamp01(obs.xpRatio || 0));
      out.push(clamp01((obs.wave || 0) / 30));
      out.push(clamp01((obs.gameTime || 0) / 600));
    },
  },
  {
    name: 'clusters',
    labels: ['clusteredSectorsNorm', 'bestClusterDirX', 'bestClusterDirY'],
    extract(obs, out) {
      out.push(clamp01((obs.clusteredSectors || 0) / NUM_DIRS));
      out.push(clampN1(obs.bestClusterDir?.x || 0));
      out.push(clampN1(obs.bestClusterDir?.y || 0));
    },
  },
  {
    name: 'boss',
    labels: ['bossPresent', 'bossDistNorm'],
    extract(obs, out) {
      out.push(obs.bossPresent ? 1 : 0);
      out.push(obs.bossPresent ? clamp01((obs.bossDist || 500) / 500) : 1);
    },
  },
  {
    name: 'movement',
    labels: ['safestDirX', 'safestDirY'],
    extract(obs, out) {
      out.push(clampN1(obs.safestDirX || 0));
      out.push(clampN1(obs.safestDirY || 0));
    },
  },
];

// Pre-compute labels and feature count
const ALL_LABELS = [];
for (const group of FEATURE_GROUPS) {
  for (const label of group.labels) {
    ALL_LABELS.push(label);
  }
}
const FEATURE_COUNT = ALL_LABELS.length;

/**
 * Create a featurizer instance.
 * Reuses a single Float64Array buffer for zero-allocation extraction.
 *
 * @returns {Featurizer}
 */
export function createFeaturizer() {
  const buffer = new Float64Array(FEATURE_COUNT);

  return {
    /** Schema version for artifact provenance */
    schemaVersion: FEATURE_SCHEMA_VERSION,

    /** Total number of features */
    featureCount: FEATURE_COUNT,

    /** Ordered feature labels */
    labels: ALL_LABELS,

    /** Feature group definitions (for analysis) */
    groups: FEATURE_GROUPS.map(g => ({ name: g.name, labels: [...g.labels] })),

    /**
     * Extract normalized feature vector from enriched observation.
     * The obs should be sensor-enriched (has encirclement, dirDanger, etc.).
     * Raw observations from observations.js also work — sensor-specific
     * fields will default to zero.
     *
     * @param {Object} obs — enriched observation
     * @returns {Float64Array} — normalized feature vector (shared buffer)
     */
    extract(obs) {
      let idx = 0;
      const out = {
        push(v) { buffer[idx++] = v; },
      };
      for (const group of FEATURE_GROUPS) {
        group.extract(obs, out);
      }
      return buffer;
    },

    /**
     * Extract features as a plain Array (for JSON serialization).
     * @param {Object} obs
     * @returns {number[]}
     */
    extractArray(obs) {
      this.extract(obs);
      return Array.from(buffer);
    },

    /**
     * Get the schema descriptor for artifact recording.
     */
    getSchema() {
      return {
        version: FEATURE_SCHEMA_VERSION,
        featureCount: FEATURE_COUNT,
        labels: [...ALL_LABELS],
        groups: FEATURE_GROUPS.map(g => ({
          name: g.name,
          labels: [...g.labels],
          offset: ALL_LABELS.indexOf(g.labels[0]),
          count: g.labels.length,
        })),
      };
    },
  };
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function clampN1(v) { return Math.max(-1, Math.min(1, v)); }

export { FEATURE_COUNT, ALL_LABELS, FEATURE_GROUPS };
