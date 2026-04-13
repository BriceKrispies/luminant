/**
 * XP and leveling system.
 * Tracks experience, handles level-ups, manages XP pickup collection.
 *
 * Leveling curve targets:
 *   Level 1-3: every 20-30s (fast early upgrades)
 *   Level 4-7: every 30-45s (mid game)
 *   Level 8+:  every 45-60s (late game)
 */

import { TYPE, STATE } from '../engine/bindings.js';

/**
 * XP required per level — tuned for 5-7 minute runs.
 * Uses a piecewise curve: gentle early, steeper later.
 */
function xpForLevel(level) {
  if (level <= 3) return Math.floor(30 + level * 15);       // 45, 60, 75
  if (level <= 7) return Math.floor(60 * Math.pow(level, 1.1)); // ~130-230
  return Math.floor(80 * Math.pow(level, 1.25));             // 250+
}

export function createXPSystem(engine, deps = {}) {
  let level = 1;
  let xp = 0;
  let xpToNext = xpForLevel(1);
  let pendingLevelUps = 0;
  let totalXPEarned = 0;

  return {
    get level() { return level; },
    get xp() { return xp; },
    get xpToNext() { return xpToNext; },
    get pendingLevelUps() { return pendingLevelUps; },
    get totalXPEarned() { return totalXPEarned; },

    consumeLevelUp() {
      if (pendingLevelUps > 0) {
        pendingLevelUps--;
        return true;
      }
      return false;
    },

    /** Process dying entities: collect XP, emit feedback, trigger skill effects */
    processDyingEntities(skills, player) {
      let xpGained = 0;
      const toRemove = [];
      const deadEnemies = [];

      engine.forEachEntity((id, type, state) => {
        if (state !== STATE.DYING) return;

        if (type >= 2 && type <= 9) {
          const ex = engine.getEntityX(id);
          const ey = engine.getEntityY(id);
          const xpValue = engine.getEntityXPValue(id);
          if (xpValue > 0) {
            const pickupId = engine.spawnEntity(
              TYPE.PICKUP_XP, ex, ey,
              1, 0, 15, 0, xpValue
            );
            if (pickupId >= 0) {
              engine.setEntityLifetime(pickupId, 30);
            }
          }

          // Skill-triggered effects on kill
          if (skills) {
            // Vampiric: heal on kill
            if (skills.hasEffect('vampiric') && player) {
              player.heal(skills.stats.healPerKill);
            }
            // Kill shockwave: damage nearby enemies
            if (skills.hasEffect('kill_shockwave')) {
              this._doShockwave(ex, ey);
            }
            // Speed on kill: handled via cooldowns in main loop
          }

          if (deps.feedback) {
            deadEnemies.push({ x: ex, y: ey });
          }
          toRemove.push(id);
        } else if (type === TYPE.PICKUP_XP) {
          xpGained += engine.getEntityXPValue(id);
          // Magnet heal: XP pickups heal 1 HP
          if (skills && skills.hasEffect('magnet_heal') && player) {
            player.heal(1);
          }
          toRemove.push(id);
        } else if (type === TYPE.PICKUP_HEALTH) {
          toRemove.push(id);
        } else {
          toRemove.push(id);
        }
      });

      // Emit death feedback with diminishing returns.
      // Small groups: every enemy gets a full explosion.
      // Large groups: fewer, subtler effects — looks like a merged blast, not a lag spike.
      if (deps.feedback && deadEnemies.length > 0) {
        const count = deadEnemies.length;
        const emitCount = Math.min(count, 5 + Math.round(Math.sqrt(count)));
        const mag = Math.max(0.5, 1.2 - Math.log10(count) * 0.3);
        const step = count / emitCount;
        for (let i = 0; i < emitCount; i++) {
          const d = deadEnemies[Math.floor(i * step)];
          deps.feedback.emit({ type: 'death', x: d.x, y: d.y, magnitude: mag });
        }
      }

      // Add XP and check level-ups
      if (xpGained > 0) {
        xp += xpGained;
        totalXPEarned += xpGained;
        while (xp >= xpToNext) {
          xp -= xpToNext;
          level++;
          xpToNext = xpForLevel(level);
          pendingLevelUps++;
        }
      }

      for (const id of toRemove) {
        engine.despawnEntity(id);
      }
    },

    /** Kill shockwave — damages enemies in small radius around death point */
    _doShockwave(x, y) {
      const nearby = engine.gridQuery(x, y, 60);
      for (const id of nearby) {
        const t = engine.getEntityType(id);
        if (t < 2 || t > 9) continue;
        if (engine.getEntityState(id) !== 1) continue;
        engine.applyDamage(id, 20);
      }
      if (deps.feedback) {
        deps.feedback.emit({ type: 'hit', x, y, magnitude: 25 });
      }
    },

    reset() {
      level = 1;
      xp = 0;
      xpToNext = xpForLevel(1);
      pendingLevelUps = 0;
      totalXPEarned = 0;
    },
  };
}
