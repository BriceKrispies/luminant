/**
 * Skinned entity renderer — draws bone-deformed mesh characters.
 *
 * Integrates with the existing entity rendering pipeline. Skinned entities
 * are drawn from their deformed mesh triangles each frame, not as sprites.
 *
 * Supports:
 *   - Filled mesh regions with per-mesh color/opacity
 *   - Stroke outlines
 *   - Debug overlays (bones, wireframe, IK targets)
 */

import { STRIDE, TX, TY, ROT, SX, SY } from '../animation/pose.js';
import { createAnimRuntime } from '../animation/runtime.js';
import { GHOST_WITCH_SKELETON, GHOST_WITCH_MESHES, GHOST_WITCH_CONFIG, GHOST_WITCH_CONSTRAINTS } from '../content/rigs/ghost-witch-rig.js';
import { GHOST_WITCH_CLIPS } from '../content/animations/ghost-witch-clips.js';
import { TYPE } from '../engine/bindings.js';

// Cache of animation runtimes per entity ID
const runtimeCache = new Map();

// Debug visualization mode
let debugMode = false;

/**
 * Get or create an animation runtime for an entity.
 */
function getRuntimeForEntity(entity) {
  let rt = runtimeCache.get(entity.id);
  if (!rt) {
    // Clone meshes so each entity has independent deformed vertex buffers
    const meshes = GHOST_WITCH_MESHES.map(m => ({
      ...m,
      deformedVertices: new Float32Array(m.bindVertices.length),
    }));

    rt = createAnimRuntime(
      GHOST_WITCH_SKELETON,
      GHOST_WITCH_CLIPS,
      meshes,
      GHOST_WITCH_CONFIG,
      GHOST_WITCH_CONSTRAINTS,
    );
    runtimeCache.set(entity.id, rt);
  }
  return rt;
}

/**
 * Check if an entity type should use skinned rendering.
 * Currently: ENEMY_FAST (ghost witch) uses it.
 */
export function isSkinnedEntity(entity) {
  return entity.type === TYPE.ENEMY_FAST;
}

/**
 * Update and draw a skinned entity.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} entity — entity snapshot
 * @param {number} dt — frame delta
 * @param {number} gameTime — total game time
 */
export function drawSkinnedEntity(ctx, entity, dt, gameTime) {
  const rt = getRuntimeForEntity(entity);
  const result = rt.update(entity, dt, gameTime);

  const dying = entity.state === 2;
  if (dying) {
    ctx.globalAlpha = Math.max(0.1, 1 - (rt.controller.stateTime / 0.6));
  }

  // Draw glow under entity
  drawGlow(ctx, entity);

  // Draw meshes in order (already sorted by slot order in the rig)
  for (const mesh of result.meshes) {
    drawMesh(ctx, mesh);
  }

  // HP bar
  if (entity.hp < entity.maxHp && !dying) {
    drawHPBar(ctx, entity);
  }

  // Debug overlay
  if (debugMode) {
    drawDebugOverlay(ctx, result);
  }

  if (dying) {
    ctx.globalAlpha = 1;
  }
}

/**
 * Draw a single deformed mesh.
 */
function drawMesh(ctx, mesh) {
  const verts = mesh.deformedVertices;
  const indices = mesh.indices;

  if (mesh.opacity !== undefined && mesh.opacity < 1) {
    ctx.globalAlpha *= mesh.opacity;
  }

  // Fill triangles
  ctx.fillStyle = mesh.color;
  ctx.beginPath();

  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t];
    const i1 = indices[t + 1];
    const i2 = indices[t + 2];

    ctx.moveTo(verts[i0 * 2], verts[i0 * 2 + 1]);
    ctx.lineTo(verts[i1 * 2], verts[i1 * 2 + 1]);
    ctx.lineTo(verts[i2 * 2], verts[i2 * 2 + 1]);
    ctx.closePath();
  }
  ctx.fill();

  // Stroke outline
  if (mesh.strokeColor && mesh.strokeWidth > 0) {
    ctx.strokeStyle = mesh.strokeColor;
    ctx.lineWidth = mesh.strokeWidth;
    ctx.stroke();
  }

  if (mesh.opacity !== undefined && mesh.opacity < 1) {
    ctx.globalAlpha /= mesh.opacity;
  }
}

/**
 * Draw glow underneath entity.
 */
function drawGlow(ctx, entity) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const r = entity.radius;
  const grad = ctx.createRadialGradient(entity.x, entity.y, 0, entity.x, entity.y, r * 2.5);
  grad.addColorStop(0, 'rgba(120, 60, 200, 0.3)');
  grad.addColorStop(0.5, 'rgba(80, 30, 160, 0.1)');
  grad.addColorStop(1, 'rgba(60, 20, 120, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(entity.x - r * 2.5, entity.y - r * 2.5, r * 5, r * 5);
  ctx.restore();
}

/**
 * Draw HP bar above entity.
 */
function drawHPBar(ctx, entity) {
  const ratio = Math.max(0, entity.hp / entity.maxHp);
  const r = entity.radius;
  const barW = r * 1.5;
  const barH = 3;
  const bx = entity.x - barW / 2;
  const by = entity.y - r - 6;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(bx, by, barW, barH);
  ctx.fillStyle = ratio > 0.3 ? '#4f4' : '#f44';
  ctx.fillRect(bx, by, barW * ratio, barH);
}

// ── Debug overlay ──

/**
 * Toggle debug visualization mode.
 */
export function setSkinnedDebug(enabled) {
  debugMode = enabled;
}

export function getSkinnedDebug() {
  return debugMode;
}

function drawDebugOverlay(ctx, result) {
  const { worldPose, skeleton, meshes, animState } = result;

  // Draw bones
  for (let i = 0; i < skeleton.boneCount; i++) {
    const off = i * STRIDE;
    const bx = worldPose[off + TX];
    const by = worldPose[off + TY];
    const br = worldPose[off + ROT];

    // Line to parent
    const pi = skeleton.bones[i].parentIndex;
    if (pi !== -1) {
      const poff = pi * STRIDE;
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.5)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(worldPose[poff + TX], worldPose[poff + TY]);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    // Bone joint dot
    ctx.fillStyle = i === 0 ? 'rgba(255, 100, 100, 0.8)' : 'rgba(80, 180, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(bx, by, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Direction indicator
    const len = skeleton.bones[i].length;
    if (len > 0) {
      const ex = bx + Math.cos(br) * len * worldPose[off + SX] * 0.3;
      const ey = by + Math.sin(br) * len * worldPose[off + SY] * 0.3;
      ctx.strokeStyle = 'rgba(255, 200, 60, 0.5)';
      ctx.lineWidth = 0.3;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
  }

  // Draw mesh wireframe
  for (const mesh of meshes) {
    const verts = mesh.deformedVertices;
    const indices = mesh.indices;
    ctx.strokeStyle = 'rgba(255, 100, 255, 0.3)';
    ctx.lineWidth = 0.3;
    for (let t = 0; t < indices.length; t += 3) {
      const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
      ctx.beginPath();
      ctx.moveTo(verts[i0 * 2], verts[i0 * 2 + 1]);
      ctx.lineTo(verts[i1 * 2], verts[i1 * 2 + 1]);
      ctx.lineTo(verts[i2 * 2], verts[i2 * 2 + 1]);
      ctx.closePath();
      ctx.stroke();
    }
  }

  // State label
  ctx.fillStyle = 'rgba(200, 200, 255, 0.7)';
  ctx.font = '3px sans-serif';
  ctx.textAlign = 'center';
  const rootOff = 0;
  ctx.fillText(animState, worldPose[rootOff + TX], worldPose[rootOff + TY] - 15);
}

/**
 * Reset cached runtimes (e.g., on game restart).
 */
export function resetSkinnedCache() {
  runtimeCache.clear();
}

/**
 * Remove a specific entity's runtime from cache.
 */
export function removeSkinnedEntity(entityId) {
  runtimeCache.delete(entityId);
}
