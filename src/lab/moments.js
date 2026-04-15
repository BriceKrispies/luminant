/**
 * Moment system for experiment/training architecture.
 *
 * "Moments" are notable gameplay events detected from observation streams.
 * Each moment has a definition, detector function, weight, tags, and cooldown.
 *
 * Moments feed into:
 * - Reward composition (moment weights contribute to reward shaping)
 * - Trajectory recording (tick-indexed moment log)
 * - Analytics (moment frequency, correlation with success)
 *
 * The system is data-driven and pluggable — new moments are added by
 * registering a definition with a detector function.
 */

/**
 * @typedef {Object} MomentDef
 * @property {string} id — unique moment identifier
 * @property {string} name — human-readable name
 * @property {string[]} tags — category tags for grouping/filtering
 * @property {number} weight — reward contribution when triggered (+positive or -negative)
 * @property {number} cooldown — minimum ticks between triggers of this moment
 * @property {function} detect — (obs, prevObs, ctx) => boolean
 */

/** Built-in moment definitions */
const MOMENT_DEFS = [
  {
    id: 'aoe_setup_success',
    name: 'AOE Setup Success',
    tags: ['combat', 'tactical', 'positive'],
    weight: 3.0,
    cooldown: 120, // 2 seconds
    detect(obs, prev, ctx) {
      // Killed 3+ enemies in a short window while near a cluster
      const killDelta = (obs.totalKills || 0) - (prev.totalKills || 0);
      return killDelta >= 3 && (obs.nearEnemyCount || 0) >= 2;
    },
  },
  {
    id: 'clutch_escape',
    name: 'Clutch Escape',
    tags: ['survival', 'positive'],
    weight: 5.0,
    cooldown: 300, // 5 seconds
    detect(obs, prev, ctx) {
      // Was at low HP, took damage, now moving away from danger
      const wasLow = (prev.hpRatio || 1) < 0.25;
      const tookDamage = (obs.recentDamageTaken || 0) > 0 || (prev.recentDamageTaken || 0) > 0;
      const movingAway = (obs.closingSpeed || 0) < -2;
      return wasLow && tookDamage && movingAway && (obs.hpRatio || 0) > 0;
    },
  },
  {
    id: 'overcommit_punished',
    name: 'Overcommit Punished',
    tags: ['combat', 'mistake', 'negative'],
    weight: -3.0,
    cooldown: 180, // 3 seconds
    detect(obs, prev, ctx) {
      // Took heavy damage while deep in enemies (encircled)
      const damageFrac = (obs.recentDamageTaken || 0) / Math.max(obs.playerMaxHP || 1, 1);
      return damageFrac > 0.15 && (obs.encirclement || 0) > 0.5 && (obs.nearEnemyCount || 0) >= 4;
    },
  },
  {
    id: 'elite_focus_success',
    name: 'Elite Focus Success',
    tags: ['combat', 'tactical', 'positive'],
    weight: 8.0,
    cooldown: 600, // 10 seconds
    detect(obs, prev, ctx) {
      // Boss was present last tick, now gone (killed)
      return (prev.bossPresent === true) && (obs.bossPresent === false);
    },
  },
  {
    id: 'pickup_greed_punished',
    name: 'Pickup Greed Punished',
    tags: ['decision', 'mistake', 'negative'],
    weight: -2.0,
    cooldown: 180,
    detect(obs, prev, ctx) {
      // Took significant damage while near pickups (chased XP into danger)
      const damageFrac = (obs.recentDamageTaken || 0) / Math.max(obs.playerMaxHP || 1, 1);
      const nearPickup = (obs.nearestPickupDist || 500) < 100;
      return damageFrac > 0.1 && nearPickup && (obs.nearEnemyCount || 0) >= 3;
    },
  },
  {
    id: 'kiting_success',
    name: 'Kiting Success',
    tags: ['movement', 'tactical', 'positive'],
    weight: 1.5,
    cooldown: 120,
    detect(obs, prev, ctx) {
      // Maintaining preferred range while enemies close, taking no damage
      const atRange = Math.abs((obs.nearestEnemyDist || 0) - (obs.preferredRange || 150)) < 60;
      const noDamage = (obs.recentDamageTaken || 0) === 0;
      const enemiesClosing = (obs.closingSpeed || 0) > 1;
      return atRange && noDamage && enemiesClosing && (obs.nearEnemyCount || 0) >= 2;
    },
  },
  {
    id: 'pressure_survived',
    name: 'Pressure Survived',
    tags: ['survival', 'positive'],
    weight: 2.0,
    cooldown: 300,
    detect(obs, prev, ctx) {
      // Was heavily encircled, survived without losing much HP
      const wasEncircled = (prev.encirclement || 0) > 0.6;
      const stillAlive = (obs.hpRatio || 0) > 0.3;
      const lowDamage = (obs.recentDamageTaken || 0) / Math.max(obs.playerMaxHP || 1, 1) < 0.1;
      return wasEncircled && stillAlive && lowDamage;
    },
  },
  {
    id: 'dead_upgrade_pick',
    name: 'Dead Upgrade Pick',
    tags: ['decision', 'mistake', 'negative'],
    weight: -10.0,
    cooldown: 0, // no cooldown, triggers on upgrade event
    detect(obs, prev, ctx) {
      // Detected via upgrade context, not observations
      if (!ctx.lastUpgrade) return false;
      const { chosen } = ctx.lastUpgrade;
      // heal_now at high HP
      if (chosen === 'heal_now' && (obs.hpRatio || 0) > 0.85) return true;
      return false;
    },
  },
  {
    id: 'synergy_completed',
    name: 'Synergy Completed',
    tags: ['decision', 'build', 'positive'],
    weight: 5.0,
    cooldown: 0,
    detect(obs, prev, ctx) {
      if (!ctx.lastUpgrade) return false;
      const upgrades = obs.acquiredUpgrades || [];
      const { chosen } = ctx.lastUpgrade;
      // Weapon + signature synergy
      if (chosen === 'pierce' && upgrades.includes('focus_fire')) return true;
      if (chosen === 'focus_fire' && upgrades.includes('pierce')) return true;
      if (chosen === 'kill_shockwave' && upgrades.includes('nova_unlock')) return true;
      if (chosen === 'nova_unlock' && upgrades.includes('kill_shockwave')) return true;
      if (chosen === 'berserker' && upgrades.includes('vampiric')) return true;
      if (chosen === 'vampiric' && upgrades.includes('berserker')) return true;
      return false;
    },
  },
];

/** Registry of moment definitions */
const momentRegistry = new Map();

// Register built-ins
for (const def of MOMENT_DEFS) {
  momentRegistry.set(def.id, def);
}

/**
 * Register a custom moment definition.
 * @param {MomentDef} def
 */
export function registerMoment(def) {
  if (!def.id || !def.detect) throw new Error('Moment must have id and detect function');
  momentRegistry.set(def.id, {
    tags: [],
    weight: 0,
    cooldown: 60,
    ...def,
  });
}

/**
 * Get all registered moment definitions.
 * @returns {MomentDef[]}
 */
export function getMomentDefs() {
  return Array.from(momentRegistry.values());
}

/**
 * Get a moment definition by id.
 * @param {string} id
 * @returns {MomentDef|undefined}
 */
export function getMomentDef(id) {
  return momentRegistry.get(id);
}

/**
 * Create a moment detector instance.
 * Tracks cooldowns and previous observation for stateful detection.
 *
 * @param {Object} [options]
 * @param {string[]} [options.enabledMoments] — subset of moment IDs to detect (default: all)
 * @param {Object} [options.weightOverrides] — { momentId: weight } overrides
 * @returns {MomentDetector}
 */
export function createMomentDetector(options = {}) {
  const { enabledMoments, weightOverrides = {} } = options;

  const cooldowns = new Map(); // momentId → tick when available
  let prevObs = null;
  const ctx = { lastUpgrade: null };

  // Determine which moments to check
  const activeDefs = enabledMoments
    ? enabledMoments.map(id => momentRegistry.get(id)).filter(Boolean)
    : Array.from(momentRegistry.values());

  return {
    /**
     * Check for moments this tick.
     * @param {Object} obs — enriched observation
     * @param {number} tick — current tick number
     * @returns {Object[]} — triggered moments: [{ id, tick, weight, tags }]
     */
    detect(obs, tick) {
      const triggered = [];

      if (!prevObs) {
        prevObs = obs;
        return triggered;
      }

      for (const def of activeDefs) {
        // Check cooldown
        const availableAt = cooldowns.get(def.id) || 0;
        if (tick < availableAt) continue;

        try {
          if (def.detect(obs, prevObs, ctx)) {
            const weight = weightOverrides[def.id] !== undefined
              ? weightOverrides[def.id]
              : def.weight;
            triggered.push({
              id: def.id,
              tick,
              weight,
              tags: def.tags,
            });
            cooldowns.set(def.id, tick + def.cooldown);
          }
        } catch (_) {
          // Detector threw — skip this moment
        }
      }

      prevObs = obs;
      ctx.lastUpgrade = null; // Reset after detection

      return triggered;
    },

    /**
     * Notify the detector of an upgrade choice (for upgrade-aware moments).
     * Call this BEFORE detect() on the same tick.
     * @param {Object} upgrade — { chosen, options, level }
     */
    notifyUpgrade(upgrade) {
      ctx.lastUpgrade = upgrade;
    },

    /**
     * Reset detector state for a new run.
     */
    reset() {
      cooldowns.clear();
      prevObs = null;
      ctx.lastUpgrade = null;
    },

    /**
     * Get the effective weight for a moment (with overrides).
     * @param {string} id
     * @returns {number}
     */
    getWeight(id) {
      if (weightOverrides[id] !== undefined) return weightOverrides[id];
      const def = momentRegistry.get(id);
      return def ? def.weight : 0;
    },
  };
}

/**
 * Compute aggregate moment reward from a list of triggered moments.
 * @param {Object[]} moments — [{ id, tick, weight, tags }]
 * @returns {number} — total moment reward contribution
 */
export function computeMomentReward(moments) {
  let total = 0;
  for (const m of moments) {
    total += m.weight;
  }
  return total;
}

/**
 * Summarize moments from a run into frequency/weight tables.
 * @param {Object[]} moments — all triggered moments from a run
 * @returns {Object} — { byId, byTag, totalReward, count }
 */
export function summarizeMoments(moments) {
  const byId = {};
  const byTag = {};
  let totalReward = 0;

  for (const m of moments) {
    // By ID
    if (!byId[m.id]) {
      byId[m.id] = { count: 0, totalWeight: 0 };
    }
    byId[m.id].count++;
    byId[m.id].totalWeight += m.weight;
    totalReward += m.weight;

    // By tag
    for (const tag of m.tags || []) {
      if (!byTag[tag]) {
        byTag[tag] = { count: 0, totalWeight: 0 };
      }
      byTag[tag].count++;
      byTag[tag].totalWeight += m.weight;
    }
  }

  return { byId, byTag, totalReward, count: moments.length };
}

export { MOMENT_DEFS };
