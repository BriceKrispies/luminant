/**
 * Run recorder for the simulation lab.
 * Produces compact, serializable run artifacts with full provenance.
 *
 * A RunRecorder is attached to a single game run and collects:
 * - metadata (runId, parentRunId, generation, seed, bot config)
 * - upgrade decisions in order
 * - notable events (kills, damage spikes, level-ups, wave transitions)
 * - periodic snapshots
 * - final summary stats
 * - reward breakdown
 *
 * The recorder is passive — it observes the game state each tick
 * and records what it sees. It does not modify any game state.
 */

let _nextId = 1;

/**
 * Generate a unique run ID.
 * Format: "run-{timestamp}-{counter}"
 */
export function generateRunId() {
  return `run-${Date.now()}-${_nextId++}`;
}

/**
 * Create a run recorder for a single simulation.
 *
 * @param {Object} options
 * @param {string} [options.runId] — explicit run ID
 * @param {string|null} [options.parentRunId] — parent run for lineage
 * @param {number} [options.generation=0] — generation in evolutionary search
 * @param {number} options.seed — RNG seed
 * @param {Object} options.botConfig — serialized bot config
 * @param {number} [options.snapshotInterval=300] — ticks between snapshots (default 5s)
 * @returns {RunRecorder}
 */
export function createRunRecorder(options) {
  const {
    runId = generateRunId(),
    parentRunId = null,
    generation = 0,
    seed,
    botConfig,
    snapshotInterval = 300,
  } = options;

  const events = [];
  const snapshots = [];
  const upgradeChoices = [];

  let prevWave = 0;
  let prevLevel = 0;
  let prevHP = -1;
  let tickCount = 0;

  return {
    runId,
    parentRunId,
    generation,

    /**
     * Called each tick with current game state.
     * Records events and periodic snapshots.
     */
    tick(state) {
      tickCount++;
      const {
        tick, gameTime, hp, maxHp, level, kills, wave,
        enemies, xp, eliteKills,
      } = state;

      // Wave transition event
      if (wave !== prevWave) {
        events.push({
          type: 'wave_change',
          tick,
          time: gameTime,
          wave,
          kills,
          hp,
          level,
        });
        prevWave = wave;
      }

      // Level up event
      if (level !== prevLevel && prevLevel > 0) {
        events.push({
          type: 'level_up',
          tick,
          time: gameTime,
          level,
          hp,
          hpRatio: maxHp > 0 ? hp / maxHp : 0,
        });
        prevLevel = level;
      }
      if (prevLevel === 0) prevLevel = level;

      // Damage spike event (lost > 20% max HP in one tick)
      if (prevHP >= 0 && maxHp > 0) {
        const hpLoss = prevHP - hp;
        if (hpLoss > maxHp * 0.2) {
          events.push({
            type: 'damage_spike',
            tick,
            time: gameTime,
            hpLoss,
            hpAfter: hp,
            hpRatio: hp / maxHp,
          });
        }
      }
      prevHP = hp;

      // Periodic snapshot
      if (tick % snapshotInterval === 0) {
        snapshots.push({
          tick,
          time: gameTime,
          hp,
          maxHp,
          level,
          kills,
          wave,
          enemies,
          xp: xp || 0,
          eliteKills: eliteKills || 0,
        });
      }
    },

    /**
     * Record an upgrade choice.
     */
    recordUpgrade(entry) {
      upgradeChoices.push({
        tick: entry.tick,
        level: entry.level,
        chosen: entry.chosen,
        options: entry.options,
      });
    },

    /**
     * Record a notable event.
     */
    recordEvent(event) {
      events.push(event);
    },

    /**
     * Finalize the run and produce the artifact.
     *
     * @param {Object} result — run result from game-runner
     * @param {Object} rewardBreakdown — from rewards.js
     * @returns {Object} — serializable run artifact
     */
    finalize(result, rewardBreakdown) {
      // Record death event if player died
      if (!result.survived) {
        events.push({
          type: 'death',
          tick: tickCount,
          time: result.survivalTime,
          kills: result.kills,
          wave: result.wave,
          level: result.level,
        });
      }

      return {
        runId,
        parentRunId,
        generation,
        seed,
        botConfig,
        snapshotInterval,

        upgradeChoices,
        events,
        snapshots,

        summary: {
          survivalTime: result.survivalTime,
          survived: result.survived,
          kills: result.kills,
          eliteKills: result.eliteKills || 0,
          level: result.level,
          wave: result.wave,
          totalXP: result.totalXP || 0,
          damageTaken: result.damageTaken || 0,
          score: result.score,
          upgradePath: result.upgradePath || [],
        },

        reward: rewardBreakdown,

        meta: {
          recordedAt: new Date().toISOString(),
          ticksSimulated: tickCount,
        },
      };
    },
  };
}

/**
 * Serialize a run artifact to JSON string.
 */
export function serializeArtifact(artifact) {
  return JSON.stringify(artifact);
}

/**
 * Deserialize a run artifact from JSON string.
 */
export function deserializeArtifact(json) {
  return typeof json === 'string' ? JSON.parse(json) : json;
}
