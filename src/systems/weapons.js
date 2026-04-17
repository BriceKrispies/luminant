/**
 * Weapon system.
 * Manages weapon state, cooldowns, and attack execution.
 * Supports projectile weapons, melee cone attacks, and skill-based behaviors.
 */

import { TYPE, FIELD } from '../engine/bindings.js';
import { WEAPON_DEFS } from '../content/weapon-types.js';
import { angle } from '../utils/math.js';
import { addEffect } from '../renderer/effects.js';

export function createWeaponSystem(engine, deps = {}) {
  let currentWeapon = 'sword';
  let cooldownTimer = 0;
  let damageMultiplier = 1;
  let cooldownMultiplier = 1;
  let projectileSpeedMultiplier = 1;

  // Stun tracking: maps entity ID → { originalSpeed, remaining }
  const stunnedEnemies = new Map();

  return {
    get currentWeapon() { return currentWeapon; },
    set currentWeapon(w) { currentWeapon = w; },

    get damageMultiplier() { return damageMultiplier; },
    set damageMultiplier(v) { damageMultiplier = v; },
    get cooldownMultiplier() { return cooldownMultiplier; },
    set cooldownMultiplier(v) { cooldownMultiplier = v; },
    get projectileSpeedMultiplier() { return projectileSpeedMultiplier; },
    set projectileSpeedMultiplier(v) { projectileSpeedMultiplier = v; },

    /** True when cooldown has elapsed and weapon can fire */
    get ready() { return cooldownTimer <= 0; },
    /** Fraction of cooldown remaining (0 = ready, 1 = just fired) */
    get cooldownRatio() {
      if (cooldownTimer <= 0) return 0;
      const def = WEAPON_DEFS[currentWeapon];
      if (!def) return 0;
      return cooldownTimer / (def.cooldown * cooldownMultiplier);
    },

    update(dt, playerX, playerY, targetX, targetY, attackRequested, skills) {
      // Tick stuns
      for (const [id, stun] of stunnedEnemies) {
        stun.remaining -= dt;
        if (stun.remaining <= 0) {
          engine.setF32(id, FIELD.SPEED, stun.originalSpeed);
          stunnedEnemies.delete(id);
        }
      }

      if (cooldownTimer > 0) {
        cooldownTimer -= dt;
      }

      if (!attackRequested || cooldownTimer > 0) return;

      const def = WEAPON_DEFS[currentWeapon];
      if (!def) return;

      // Compute effective cooldown with berserker
      let effectiveCooldown = def.cooldown * cooldownMultiplier;
      if (skills) {
        effectiveCooldown *= skills.getBerserkerCooldownMultiplier();
      }
      cooldownTimer = effectiveCooldown;

      // Compute effective damage with focus fire
      let effectiveDmgMult = damageMultiplier;
      if (skills) {
        effectiveDmgMult *= skills.getFocusDamageMultiplier();
      }

      const facing = angle(playerX, playerY, targetX, targetY);

      if (def.pattern === 'cone') {
        this._doConeAttack(def, playerX, playerY, facing, effectiveDmgMult, skills);
      } else if (def.pattern === 'single') {
        this._spawnProjectile(def, playerX, playerY, facing, effectiveDmgMult, skills);
      } else if (def.pattern === 'spread') {
        const spread = def.spreadAngle || 0.3;
        const count = def.spreadCount || 3;
        const step = spread / (count - 1);
        const start = facing - spread / 2;
        for (let i = 0; i < count; i++) {
          this._spawnProjectile(def, playerX, playerY, start + step * i, effectiveDmgMult, skills);
        }
      } else if (def.pattern === 'burst') {
        const count = def.burstCount || 5;
        const step = (Math.PI * 2) / count;
        for (let i = 0; i < count; i++) {
          this._spawnProjectile(def, playerX, playerY, i * step, effectiveDmgMult, skills);
        }
      }
    },

    _doConeAttack(def, px, py, facing, dmgMult, skills) {
      const range = def.range || 70;
      let coneAngle = def.coneAngle || 1.0;
      // Skill bonus cone
      if (skills && skills.stats.coneAngleBonus) {
        coneAngle += skills.stats.coneAngleBonus;
      }
      const halfAngle = coneAngle / 2;
      const dmg = def.damage * dmgMult;
      let stunDur = def.stunDuration || 0;
      if (skills && skills.stats.stunDurationBonus) {
        stunDur *= (1 + skills.stats.stunDurationBonus);
      }
      const stunFactor = def.stunSpeedFactor || 0.2;

      const nearby = engine.gridQuery(px, py, range);
      let hitCount = 0;

      for (const id of nearby) {
        const etype = engine.getEntityType(id);
        if (etype < 2 || etype > 13) continue;
        if (engine.getEntityState(id) !== 1) continue;

        const ex = engine.getEntityX(id);
        const ey = engine.getEntityY(id);

        const angleToEnemy = Math.atan2(ey - py, ex - px);
        let angleDiff = angleToEnemy - facing;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        if (Math.abs(angleDiff) > halfAngle) continue;

        engine.applyDamage(id, dmg);
        hitCount++;

        // Track hit for explosive_fifth
        if (skills) {
          skills.onHit();
          if (skills.shouldExplode()) {
            this._doExplosion(ex, ey, dmg * 0.5);
          }
        }

        if (deps.feedback) {
          deps.feedback.emit({ type: 'hit', x: ex, y: ey, magnitude: dmg });
        } else {
          addEffect('hit', ex, ey, { duration: 0.2 });
        }

        // Apply stun
        if (stunDur > 0) {
          const currentSpeed = engine.getEntitySpeed(id);
          if (stunnedEnemies.has(id)) {
            stunnedEnemies.get(id).remaining = stunDur;
          } else {
            stunnedEnemies.set(id, {
              originalSpeed: currentSpeed,
              remaining: stunDur,
            });
            engine.setF32(id, FIELD.SPEED, currentSpeed * stunFactor);
          }
        }
      }

      addEffect('slash', px, py, {
        duration: 0.2,
        angle: facing,
        range,
        coneAngle,
        hitCount,
      });
    },

    _spawnProjectile(def, px, py, angle, dmgMult, skills) {
      const speed = def.projectileSpeed * projectileSpeedMultiplier;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const dmg = def.damage * dmgMult;

      const id = engine.spawnEntity(
        def.projectileType || TYPE.PROJECTILE_BULLET,
        px, py,
        1,
        speed,
        def.projectileRadius || 5,
        dmg,
        0
      );
      if (id >= 0) {
        engine.setEntityVelocity(id, vx, vy);
        engine.setEntityLifetime(id, def.lifetime || 1.5);
        // Pierce: increase HP so projectile survives multiple hits
        if (skills && skills.stats.pierceCount > 0) {
          engine.setF32(id, FIELD.HP, 1 + skills.stats.pierceCount);
        }
      }
    },

    /** AoE explosion at a point — used by explosive_fifth */
    _doExplosion(x, y, dmg) {
      const nearby = engine.gridQuery(x, y, 50);
      for (const id of nearby) {
        const t = engine.getEntityType(id);
        if (t < 2 || t > 9) continue;
        if (engine.getEntityState(id) !== 1) continue;
        engine.applyDamage(id, dmg);
      }
      if (deps.feedback) {
        deps.feedback.emit({ type: 'hit', x, y, magnitude: dmg * 1.5 });
      }
      addEffect('death', x, y, { duration: 0.3, magnitude: 2 });
    },

    reset() {
      currentWeapon = 'sword';
      cooldownTimer = 0;
      damageMultiplier = 1;
      cooldownMultiplier = 1;
      projectileSpeedMultiplier = 1;
      stunnedEnemies.clear();
    },
  };
}
