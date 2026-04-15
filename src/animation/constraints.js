/**
 * Pose constraints — run after clip sampling/blending, before skinning.
 *
 * Supported:
 *   - Aim/look constraint: rotate a bone toward a world target
 *   - Trail constraint: chain of bones that lag behind the parent
 */

import { STRIDE, TX, TY, ROT, SX, SY } from './pose.js';

/**
 * Aim constraint — rotate a bone in world space to point toward a target.
 *
 * @param {Float64Array} worldPose — world pose (read/write)
 * @param {number} boneIndex — bone to rotate
 * @param {number} targetX — world target x
 * @param {number} targetY — world target y
 * @param {number} weight — 0..1 blend
 * @param {number} [offset] — angular offset in radians (0 = bone +X aims at target)
 */
export function aimConstraint(worldPose, boneIndex, targetX, targetY, weight = 1, offset = 0) {
  const off = boneIndex * STRIDE;
  const bx = worldPose[off + TX];
  const by = worldPose[off + TY];
  const currentRot = worldPose[off + ROT];

  const desiredRot = Math.atan2(targetY - by, targetX - bx) + offset;
  let diff = desiredRot - currentRot;
  // Shortest path
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;

  worldPose[off + ROT] = currentRot + diff * weight;
}

/**
 * Trail constraint — a chain of bones that smoothly lag behind movement.
 * Each bone in the chain tends toward the position "behind" its parent.
 *
 * Call each frame. Maintains internal state via the prevPositions array.
 *
 * @param {Float64Array} worldPose
 * @param {number[]} chainBoneIndices — bone indices from base to tip
 * @param {Float64Array} prevPositions — flat [x,y, x,y, ...] for each bone in chain, persisted across frames
 * @param {number} stiffness — 0..1 (0=very loose, 1=rigid)
 * @param {number} dt — frame delta time
 */
export function trailConstraint(worldPose, chainBoneIndices, prevPositions, stiffness = 0.3, dt = 1 / 60) {
  const rate = 1 - Math.pow(1 - stiffness, dt * 60);

  for (let i = 0; i < chainBoneIndices.length; i++) {
    const bi = chainBoneIndices[i];
    const off = bi * STRIDE;
    const px = i * 2;

    // Current world position from pose hierarchy evaluation
    const wx = worldPose[off + TX];
    const wy = worldPose[off + TY];

    // Smooth toward current position
    const oldX = prevPositions[px];
    const oldY = prevPositions[px + 1];

    // Initialize on first frame (NaN check)
    if (oldX !== oldX || oldY !== oldY) {
      prevPositions[px] = wx;
      prevPositions[px + 1] = wy;
      continue;
    }

    const nx = oldX + (wx - oldX) * rate;
    const ny = oldY + (wy - oldY) * rate;

    prevPositions[px] = nx;
    prevPositions[px + 1] = ny;

    // Write back smoothed position
    worldPose[off + TX] = nx;
    worldPose[off + TY] = ny;

    // Orient toward parent bone position for natural trailing
    if (i > 0) {
      const parentBi = chainBoneIndices[i - 1];
      const poff = parentBi * STRIDE;
      const parentX = worldPose[poff + TX];
      const parentY = worldPose[poff + TY];
      worldPose[off + ROT] = Math.atan2(ny - parentY, nx - parentX);
    }
  }
}

/**
 * Create persistent trail state for a chain.
 */
export function createTrailState(chainLength) {
  const state = new Float64Array(chainLength * 2);
  state.fill(NaN);
  return state;
}
