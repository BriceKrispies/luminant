/**
 * Enemy spawn system.
 * Spawns enemies at the edges of the viewport, always outside the visible area.
 */

import { TYPE } from '../engine/bindings.js';
import { ENEMY_DEFS } from '../content/enemy-types.js';
import { randomAngle, pointOnCircle, randomInRange } from '../utils/math.js';

export function createSpawnerSystem(engine) {
  return {
    /**
     * Spawn enemies around the player position.
     * @param {number} count - how many to spawn
     * @param {number} px - player x
     * @param {number} py - player y
     * @param {string[]} types - allowed enemy type keys
     * @param {number} minDist - minimum distance from player
     * @param {number} maxDist - maximum distance from player
     */
    spawnWave(count, px, py, types, minDist = 400, maxDist = 700) {
      const spawned = [];
      for (let i = 0; i < count; i++) {
        const typeKey = types[Math.floor(Math.random() * types.length)];
        const def = ENEMY_DEFS[typeKey];
        if (!def) continue;

        const angle = randomAngle();
        const dist = randomInRange(minDist, maxDist);
        const pos = pointOnCircle(px, py, dist, angle);

        // Clamp to world bounds
        const x = Math.max(20, Math.min(pos.x, engine.worldW - 20));
        const y = Math.max(20, Math.min(pos.y, engine.worldH - 20));

        const id = engine.spawnEntity(
          def.type, x, y,
          def.hp, def.speed, def.radius, def.damage, def.xp
        );
        if (id >= 0) spawned.push(id);
      }
      return spawned;
    },

    /** Spawn a single enemy of a specific type at a position */
    spawnOne(typeKey, x, y) {
      const def = ENEMY_DEFS[typeKey];
      if (!def) return -1;
      return engine.spawnEntity(def.type, x, y, def.hp, def.speed, def.radius, def.damage, def.xp);
    },
  };
}
