/**
 * Elite enemy system.
 * Periodically spawns tougher enemies that drop big XP.
 * Hooks into the director for timing and the spawner for placement.
 */

import { ENEMY_DEFS } from '../content/enemy-types.js';
import { FIELD, STATE } from '../engine/bindings.js';

const ELITE_INTERVAL = 50;     // seconds between elite spawns
const FIRST_ELITE_AT = 45;     // first elite spawns early for excitement
const ELITE_HP_MULT = 4;
const ELITE_RADIUS_MULT = 1.4;
const ELITE_XP_MULT = 8;
const ELITE_SPEED_MULT = 0.8;  // slightly slower — makes them feel heavy

// Pick types that feel good as elites
const ELITE_TYPES = ['tank', 'basic', 'fast'];

export function createEliteSystem(engine, spawner) {
  let timer = 0;
  let eliteCount = 0;
  const activeElites = new Set(); // entity IDs currently alive

  return {
    get eliteCount() { return eliteCount; },
    get activeEliteCount() { return activeElites.size; },

    update(dt, playerX, playerY, gameTime) {
      timer += dt;

      // Determine spawn threshold: first one earlier, then every ELITE_INTERVAL
      const nextSpawnAt = eliteCount === 0 ? FIRST_ELITE_AT : ELITE_INTERVAL;

      if (timer >= nextSpawnAt) {
        timer = 0;
        this._spawnElite(playerX, playerY, gameTime);
      }

      // Clean dead elites from tracking
      for (const id of activeElites) {
        const state = engine.getEntityState(id);
        if (state !== STATE.ACTIVE) {
          activeElites.delete(id);
        }
      }
    },

    _spawnElite(px, py, gameTime) {
      // Pick a type — later game gets tougher elites
      const pool = gameTime < 120 ? ['basic'] : ELITE_TYPES;
      const typeKey = pool[Math.floor(Math.random() * pool.length)];
      const def = ENEMY_DEFS[typeKey];
      if (!def) return;

      // Spawn at medium distance
      const angle = Math.random() * Math.PI * 2;
      const dist = 350 + Math.random() * 150;
      let x = px + Math.cos(angle) * dist;
      let y = py + Math.sin(angle) * dist;
      x = Math.max(30, Math.min(x, engine.worldW - 30));
      y = Math.max(30, Math.min(y, engine.worldH - 30));

      // Scale with game time — elites get tougher as the run goes on
      const timeMult = 1 + (gameTime / 300) * 0.5;
      const hp = Math.round(def.hp * ELITE_HP_MULT * timeMult);
      const speed = Math.round(def.speed * ELITE_SPEED_MULT);
      const radius = Math.round(def.radius * ELITE_RADIUS_MULT);
      const xp = Math.round(def.xp * ELITE_XP_MULT);

      const id = engine.spawnEntity(def.type, x, y, hp, speed, radius, def.damage * 1.5, xp);
      if (id >= 0) {
        if (def.behaviorId != null) engine.setBehavior(id, def.behaviorId);
        activeElites.add(id);
        eliteCount++;
      }
    },

    /** Check if an entity ID is an elite */
    isElite(id) {
      return activeElites.has(id);
    },

    /** Iterate active elite entity IDs */
    _activeEliteIds() {
      return activeElites;
    },

    reset() {
      timer = 0;
      eliteCount = 0;
      activeElites.clear();
    },
  };
}
