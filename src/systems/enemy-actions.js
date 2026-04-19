/**
 * Enemy action polling system.
 *
 * WAT behavior steering can set per-entity action flags (shoot, summon) each
 * tick. This system polls those flags, performs the JS-side effects (spawning
 * a projectile or summoning a minion), then clears the flags. It also advances
 * enemy-origin projectile collisions against the player, since the WAT
 * projectile-collision loop only damages enemies.
 */

import { TYPE, STATE, FIELD, ACTION_FLAG, MAX_ENTITIES, ENTITY_STRIDE } from '../engine/bindings.js';
import { ENEMY_DEFS } from '../content/enemy-types.js';

const ENEMY_BULLET_SPEED = 220;
const ENEMY_BULLET_RADIUS = 4;
const ENEMY_BULLET_LIFETIME = 2.5;

export function createEnemyActionsSystem(engine, spawner, player) {
  return {
    update(dt) {
      const pid = engine.getPlayerId();
      if (pid < 0) return;
      const px = engine.getEntityX(pid);
      const py = engine.getEntityY(pid);
      const pvx = engine.getEntityVX(pid);
      const pvy = engine.getEntityVY(pid);

      // --- Poll enemy action flags (SHOOT / SUMMON) ---
      const buf = engine.mem;
      for (let id = 0; id < MAX_ENTITIES; id++) {
        const base = id * ENTITY_STRIDE;
        if (buf.getInt32(base + FIELD.STATE, true) !== STATE.ACTIVE) continue;
        const type = buf.getInt32(base + FIELD.TYPE, true);
        if (type < 2 || type > 13) continue;
        const flags = buf.getInt32(base + FIELD.FLAGS, true);
        if ((flags & (ACTION_FLAG.SHOOT | ACTION_FLAG.SUMMON)) === 0) continue;

        const ex = engine.getEntityX(id);
        const ey = engine.getEntityY(id);

        if (flags & ACTION_FLAG.SHOOT) {
          fireProjectile(ex, ey, px, py, pvx, pvy, type);
        }
        if (flags & ACTION_FLAG.SUMMON) {
          summonMinions(ex, ey, type);
        }

        // Clear both bits; keep behavior_id + sub-phase intact.
        buf.setInt32(base + FIELD.FLAGS, flags & ~(ACTION_FLAG.SHOOT | ACTION_FLAG.SUMMON), true);
      }

      // --- Enemy projectiles vs player ---
      const pr = engine.getEntityRadius(pid);
      for (let id = 0; id < MAX_ENTITIES; id++) {
        const base = id * ENTITY_STRIDE;
        if (buf.getInt32(base + FIELD.STATE, true) !== STATE.ACTIVE) continue;
        if (buf.getInt32(base + FIELD.TYPE, true) !== TYPE.PROJECTILE_ENEMY) continue;

        const x = buf.getFloat32(base + FIELD.X, true);
        const y = buf.getFloat32(base + FIELD.Y, true);
        const ddx = x - px;
        const ddy = y - py;
        const d = Math.hypot(ddx, ddy);
        const bulletR = buf.getFloat32(base + FIELD.RADIUS, true);
        if (d < pr + bulletR) {
          const dmg = buf.getFloat32(base + FIELD.DAMAGE, true);
          engine.applyDamage(pid, dmg);
          engine.despawnEntity(id);
        }
      }
    },
  };

  function fireProjectile(ex, ey, px, py, pvx, pvy, shooterType) {
    const key = keyForType(shooterType);
    const def = ENEMY_DEFS[key] || ENEMY_DEFS.ranged;
    const speed = def.projectileSpeed || ENEMY_BULLET_SPEED;
    const dmg = def.projectileDamage || 8;
    const aim = computeLeadAim(ex, ey, px, py, pvx, pvy, speed);
    const id = engine.spawnEntity(
      TYPE.PROJECTILE_ENEMY,
      ex, ey,
      1,                  // hp (arbitrary — not damaged)
      speed,              // speed (used by WAT integration display, see below)
      ENEMY_BULLET_RADIUS,
      dmg,
      0,                  // xp
    );
    if (id < 0) return;
    // WAT's update_projectiles moves by stored velocity (vx, vy) — set it directly.
    engine.setEntityVelocity(id, aim.x * speed, aim.y * speed);
    engine.setEntityLifetime(id, ENEMY_BULLET_LIFETIME);
  }

  function summonMinions(ex, ey, summonerType) {
    const key = keyForType(summonerType);
    const def = ENEMY_DEFS[key] || ENEMY_DEFS.summoner;
    const minionKey = def.summonKey || 'basic';
    const count = def.summonCount || 2;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 40 + Math.random() * 30;
      spawner.spawnOne(minionKey, ex + Math.cos(ang) * r, ey + Math.sin(ang) * r);
    }
  }
}

// Reverse-lookup cache (type → key). Rebuilt lazily.
let typeToKey = null;
function keyForType(type) {
  if (!typeToKey) {
    typeToKey = {};
    for (const [k, d] of Object.entries(ENEMY_DEFS)) typeToKey[d.type] = k;
  }
  return typeToKey[type];
}

/**
 * First-order lead prediction: return unit aim vector from (ex,ey) toward the
 * point where a bullet of `speed` will intercept a target currently at (px,py)
 * moving at (pvx,pvy). Falls back to direct aim when no real intercept exists
 * (target as fast as or faster than the bullet, or degenerate geometry).
 *
 * Derivation: solve |(P-E) + V·t| = s·t for smallest positive t →
 *   (V·V - s²)·t² + 2·(D·V)·t + D·D = 0, where D = P - E.
 */
export function computeLeadAim(ex, ey, px, py, pvx, pvy, speed) {
  const dx = px - ex;
  const dy = py - ey;
  const a = pvx * pvx + pvy * pvy - speed * speed;
  const b = 2 * (dx * pvx + dy * pvy);
  const c = dx * dx + dy * dy;
  let ax = dx;
  let ay = dy;
  if (a < -1e-6) {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b + sq) / (2 * a);
      const t2 = (-b - sq) / (2 * a);
      let t = Infinity;
      if (t1 > 0 && t1 < t) t = t1;
      if (t2 > 0 && t2 < t) t = t2;
      if (Number.isFinite(t)) {
        ax = dx + pvx * t;
        ay = dy + pvy * t;
      }
    }
  }
  const len = Math.hypot(ax, ay) || 1;
  return { x: ax / len, y: ay / len };
}
