/**
 * Phase-based wave director.
 * Controls spawn tempo, composition, and scaling over a 5–7 minute run.
 * Deterministic per tick — all scaling is smooth interpolation.
 */

import { PHASES } from '../content/wave-definitions.js';
import { ENEMY_DEFS } from '../content/enemy-types.js';

function lerpPair(pair, t) {
  return pair[0] + (pair[1] - pair[0]) * t;
}

export function createDirectorSystem(engine, spawner) {
  let gameTime = 0;
  let spawnTimer = 0;
  let totalKills = 0;
  let currentPhaseIndex = 0;

  function getPhase() {
    // Find the phase we're currently in
    for (let i = PHASES.length - 1; i >= 0; i--) {
      if (gameTime >= PHASES[i].startTime) return i;
    }
    return 0;
  }

  function getInterpolated() {
    const idx = getPhase();
    const phase = PHASES[idx];
    const t = Math.min((gameTime - phase.startTime) / (phase.endTime - phase.startTime), 1);

    return {
      types: phase.types,
      spawnInterval: lerpPair(phase.spawnInterval, t),
      spawnBatch: Math.round(lerpPair(phase.spawnBatch, t)),
      maxConcurrent: Math.round(lerpPair(phase.maxConcurrent, t)),
      hpScale: lerpPair(phase.hpScale, t),
      speedScale: lerpPair(phase.speedScale, t),
      xpScale: lerpPair(phase.xpScale, t),
      spawnDist: lerpPair(phase.spawnDist, t),
    };
  }

  return {
    get waveIndex() { return getPhase(); },
    get waveTimer() { return gameTime; },
    get totalKills() { return totalKills; },
    get gameTime() { return gameTime; },

    /** Get current phase parameters (for elite system / other consumers) */
    getParams() {
      return getInterpolated();
    },

    update(dt, playerX, playerY, currentEnemyCount) {
      gameTime += dt;
      spawnTimer += dt;
      currentPhaseIndex = getPhase();

      // Track kills
      const frameKills = engine.getKills();
      totalKills += frameKills;

      const params = getInterpolated();

      // After phase 4 ends (420s+), keep escalating but cap entity count
      if (gameTime > 420) {
        const overtime = gameTime - 420;
        params.maxConcurrent = Math.min(400, Math.round(500 + overtime * 2));
        params.spawnInterval = Math.max(0.15, 0.3 - overtime * 0.0005);
        params.spawnBatch = Math.min(12, Math.round(16 + overtime * 0.1));
        params.hpScale = 2.0 + overtime * 0.01;
        params.speedScale = 1.4 + overtime * 0.003;
      }

      if (spawnTimer >= params.spawnInterval && currentEnemyCount < params.maxConcurrent) {
        spawnTimer = 0;
        const batch = Math.min(params.spawnBatch, params.maxConcurrent - currentEnemyCount);
        if (batch > 0) {
          spawnScaled(spawner, engine, batch, playerX, playerY, params);
        }
      }
    },

    reset() {
      gameTime = 0;
      spawnTimer = 0;
      totalKills = 0;
      currentPhaseIndex = 0;
    },
  };
}

/**
 * Spawn enemies with director-scaled stats.
 */
function spawnScaled(spawner, engine, count, px, py, params) {
  const { types, hpScale, speedScale, xpScale, spawnDist } = params;
  const minDist = spawnDist;
  const maxDist = spawnDist + 200;

  for (let i = 0; i < count; i++) {
    const typeKey = types[Math.floor(Math.random() * types.length)];
    const def = ENEMY_DEFS[typeKey];
    if (!def) continue;

    const angle = Math.random() * Math.PI * 2;
    const dist = minDist + Math.random() * (maxDist - minDist);
    let x = px + Math.cos(angle) * dist;
    let y = py + Math.sin(angle) * dist;
    x = Math.max(20, Math.min(x, engine.worldW - 20));
    y = Math.max(20, Math.min(y, engine.worldH - 20));

    const hp = Math.round(def.hp * hpScale);
    const speed = Math.round(def.speed * speedScale);
    const xp = Math.round(def.xp * xpScale);

    engine.spawnEntity(def.type, x, y, hp, speed, def.radius, def.damage, xp);
  }
}
