/**
 * Entity rendering — draws player, enemies, projectiles, pickups.
 * Uses stylized 2D shapes with glow for readability at scale.
 */

import { TYPE, STATE } from '../engine/bindings.js';
import { ENEMY_DEFS, TYPE_TO_KEY } from '../content/enemy-types.js';
import { WEAPON_DEFS } from '../content/weapon-types.js';
import { createCreatureResolver } from './creatures/creature-model.js';
import { drawCreature } from './creatures/draw-canvas.js';
import { getArchetype } from './creatures/archetypes.js';
import { isSkinnedEntity, drawSkinnedEntity, resetSkinnedCache } from './skinned-entities.js';

// Shared creature resolver for Canvas 2D renderer
let creatureResolver = null;
let lastSnapshotTime = -1;

function getResolver() {
  if (!creatureResolver) creatureResolver = createCreatureResolver();
  return creatureResolver;
}

export function resetCreatureResolver() {
  if (creatureResolver) creatureResolver.reset();
}

export function drawEntities(ctx, snapshot, camera) {
  const view = camera.getViewBounds();
  const margin = 50;
  const resolver = getResolver();
  const dt = snapshot.time - (lastSnapshotTime >= 0 ? lastSnapshotTime : snapshot.time);
  lastSnapshotTime = snapshot.time;

  // Sort: pickups → enemies → projectiles → player (draw order)
  const pickups = [];
  const enemies = [];
  const projectiles = [];
  let player = null;

  for (const e of snapshot.entities) {
    if (e.state === STATE.FREE) continue;
    // Frustum cull
    if (e.x < view.left - margin || e.x > view.right + margin ||
        e.y < view.top - margin || e.y > view.bottom + margin) continue;

    if (e.type === TYPE.PLAYER) player = e;
    else if (e.type >= 2 && e.type <= 9) enemies.push(e);
    else if (e.type >= 10 && e.type <= 19) projectiles.push(e);
    else if (e.type >= 20) pickups.push(e);
  }

  // Draw pickups
  for (const p of pickups) drawPickup(ctx, p, snapshot.time);

  // Draw enemies — skinned > creature system > legacy fallback
  for (const e of enemies) {
    if (isSkinnedEntity(e)) {
      drawSkinnedEntity(ctx, e, Math.max(dt, 1 / 60), snapshot.time);
    } else {
      const model = resolver.resolve(e, snapshot.time, Math.max(dt, 1 / 60));
      if (model) {
        drawCreature(ctx, model);
      } else {
        drawEnemy(ctx, e);
      }
    }
  }

  // Draw projectiles
  for (const p of projectiles) drawProjectile(ctx, p);

  // Draw player on top
  if (player) drawPlayer(ctx, player, snapshot.time);
}

function drawPlayer(ctx, e, time) {
  const x = e.x;
  const y = e.y;
  const r = e.radius;
  const pulse = 1 + Math.sin(time * 4) * 0.08;

  // Outer glow
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glowR = r * 3 * pulse;
  const grad = ctx.createRadialGradient(x, y, 0, x, y, glowR);
  grad.addColorStop(0, 'rgba(255, 220, 140, 0.2)');
  grad.addColorStop(0.5, 'rgba(255, 180, 80, 0.05)');
  grad.addColorStop(1, 'rgba(255, 150, 50, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(x - glowR, y - glowR, glowR * 2, glowR * 2);
  ctx.restore();

  // Body
  ctx.fillStyle = '#ffd080';
  ctx.beginPath();
  ctx.arc(x, y, r * pulse, 0, Math.PI * 2);
  ctx.fill();

  // Inner highlight
  ctx.fillStyle = 'rgba(255, 240, 200, 0.6)';
  ctx.beginPath();
  ctx.arc(x - r * 0.2, y - r * 0.2, r * 0.4, 0, Math.PI * 2);
  ctx.fill();

  // Direction indicator based on velocity
  if (Math.abs(e.vx) > 1 || Math.abs(e.vy) > 1) {
    const angle = Math.atan2(e.vy, e.vx);
    ctx.strokeStyle = 'rgba(255, 255, 200, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * r * 1.8, y + Math.sin(angle) * r * 1.8);
    ctx.stroke();
  }

  // HP bar
  if (e.hp < e.maxHp) {
    drawHPBar(ctx, x, y - r - 8, r * 2, e.hp, e.maxHp, '#4f4');
  }
}

function drawEnemy(ctx, e) {
  const x = e.x;
  const y = e.y;
  const r = e.radius;
  const key = TYPE_TO_KEY[e.type];
  const def = key ? ENEMY_DEFS[key] : null;
  const color = def ? def.color : '#888';
  const dying = e.state === STATE.DYING;

  if (dying) {
    ctx.globalAlpha = 0.4;
  }

  // Glow under enemy
  if (def && def.glowColor) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 2.5);
    glow.addColorStop(0, def.glowColor);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - r * 2.5, y - r * 2.5, r * 5, r * 5);
    ctx.restore();
  }

  // Body — darker silhouette with colored edge
  ctx.fillStyle = color;
  ctx.beginPath();

  if (e.type === TYPE.ENEMY_TANK) {
    // Square-ish for tanks
    const s = r * 0.85;
    ctx.moveTo(x - s, y - s);
    ctx.lineTo(x + s, y - s);
    ctx.lineTo(x + s, y + s);
    ctx.lineTo(x - s, y + s);
    ctx.closePath();
  } else if (e.type === TYPE.ENEMY_FAST) {
    // Triangle for fast enemies
    const angle = Math.atan2(e.vy, e.vx);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.moveTo(r * 1.2, 0);
    ctx.lineTo(-r * 0.7, -r * 0.8);
    ctx.lineTo(-r * 0.7, r * 0.8);
    ctx.closePath();
    ctx.restore();
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill();

  // Dark interior for contrast
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
  ctx.fill();

  // HP bar
  if (e.hp < e.maxHp) {
    drawHPBar(ctx, x, y - r - 6, r * 1.5, e.hp, e.maxHp, '#4f4');
  }

  if (dying) {
    ctx.globalAlpha = 1;
  }
}

function drawProjectile(ctx, e) {
  const x = e.x;
  const y = e.y;
  const r = e.radius;

  // Determine color from projectile type
  let color = '#ff8';
  let glowColor = 'rgba(255, 255, 120, 0.4)';
  if (e.type === TYPE.PROJECTILE_SPREAD) {
    color = '#f84';
    glowColor = 'rgba(255, 130, 60, 0.4)';
  } else if (e.type === TYPE.PROJECTILE_AOE) {
    color = '#4cf';
    glowColor = 'rgba(60, 200, 255, 0.4)';
  }

  // Glow trail
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
  grad.addColorStop(0, glowColor);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
  ctx.restore();

  // Core
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // Bright center
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawPickup(ctx, e, time) {
  const x = e.x;
  const y = e.y + Math.sin(time * 3 + e.x) * 3;
  const r = 6;
  const isXP = e.type === TYPE.PICKUP_XP;
  const color = isXP ? '#4af' : '#f44';

  // Glow
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const grad = ctx.createRadialGradient(x, y, 0, x, y, 20);
  grad.addColorStop(0, isXP ? 'rgba(60, 160, 255, 0.3)' : 'rgba(255, 60, 60, 0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(x - 20, y - 20, 40, 40);
  ctx.restore();

  // Diamond shape
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.7, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.7, y);
  ctx.closePath();
  ctx.fill();
}

function drawHPBar(ctx, x, y, width, hp, maxHp, color) {
  const ratio = Math.max(0, hp / maxHp);
  const barW = width;
  const barH = 3;
  const bx = x - barW / 2;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(bx, y, barW, barH);

  ctx.fillStyle = ratio > 0.3 ? color : '#f44';
  ctx.fillRect(bx, y, barW * ratio, barH);
}
