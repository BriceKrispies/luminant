/**
 * Pose blending — mix two poses, apply additive layers, masked blending.
 */

import { STRIDE, TX, TY, ROT, SX, SY } from './pose.js';

/**
 * Normalize angle to [-PI, PI].
 */
function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Interpolate rotation shortest-path.
 */
function lerpAngle(a, b, t) {
  return a + normalizeAngle(b - a) * t;
}

/**
 * Blend two poses by weight. Result written to outPose.
 * weight=0 → all poseA, weight=1 → all poseB.
 *
 * Translation and rotation blend linearly (rotation via shortest-path).
 * Scale blends linearly.
 *
 * @param {Float64Array} poseA
 * @param {Float64Array} poseB
 * @param {number} weight — 0..1
 * @param {Float64Array} outPose — can be same as poseA or poseB
 * @param {number} boneCount
 */
export function blendPoses(poseA, poseB, weight, outPose, boneCount) {
  const t = Math.max(0, Math.min(1, weight));
  const invT = 1 - t;
  for (let i = 0; i < boneCount; i++) {
    const off = i * STRIDE;
    outPose[off + TX] = poseA[off + TX] * invT + poseB[off + TX] * t;
    outPose[off + TY] = poseA[off + TY] * invT + poseB[off + TY] * t;
    outPose[off + ROT] = lerpAngle(poseA[off + ROT], poseB[off + ROT], t);
    outPose[off + SX] = poseA[off + SX] * invT + poseB[off + SX] * t;
    outPose[off + SY] = poseA[off + SY] * invT + poseB[off + SY] * t;
  }
}

/**
 * Apply an additive pose on top of a base pose.
 * additivePose values: tx/ty/rot are offsets from zero, sx/sy are offsets from 1.
 *
 * @param {Float64Array} basePose — modified in place
 * @param {Float64Array} additivePose — delta values
 * @param {number} weight — blend weight for the additive layer
 * @param {number} boneCount
 */
export function applyAdditive(basePose, additivePose, weight, boneCount) {
  for (let i = 0; i < boneCount; i++) {
    const off = i * STRIDE;
    basePose[off + TX] += additivePose[off + TX] * weight;
    basePose[off + TY] += additivePose[off + TY] * weight;
    basePose[off + ROT] += additivePose[off + ROT] * weight;
    basePose[off + SX] *= 1 + (additivePose[off + SX] - 1) * weight;
    basePose[off + SY] *= 1 + (additivePose[off + SY] - 1) * weight;
  }
}

/**
 * Masked blend: only blend bones in the mask set.
 * boneMask is a Set of bone indices or an array of booleans.
 *
 * @param {Float64Array} poseA
 * @param {Float64Array} poseB
 * @param {number} weight
 * @param {Float64Array} outPose
 * @param {number} boneCount
 * @param {Set|boolean[]} boneMask — which bones to blend (true/present = blend)
 */
export function maskedBlend(poseA, poseB, weight, outPose, boneCount, boneMask) {
  const t = Math.max(0, Math.min(1, weight));
  const invT = 1 - t;
  const isSet = boneMask instanceof Set;

  for (let i = 0; i < boneCount; i++) {
    const off = i * STRIDE;
    const masked = isSet ? boneMask.has(i) : boneMask[i];

    if (masked) {
      outPose[off + TX] = poseA[off + TX] * invT + poseB[off + TX] * t;
      outPose[off + TY] = poseA[off + TY] * invT + poseB[off + TY] * t;
      outPose[off + ROT] = lerpAngle(poseA[off + ROT], poseB[off + ROT], t);
      outPose[off + SX] = poseA[off + SX] * invT + poseB[off + SX] * t;
      outPose[off + SY] = poseA[off + SY] * invT + poseB[off + SY] * t;
    } else {
      // Not masked — copy from poseA unchanged
      outPose[off + TX] = poseA[off + TX];
      outPose[off + TY] = poseA[off + TY];
      outPose[off + ROT] = poseA[off + ROT];
      outPose[off + SX] = poseA[off + SX];
      outPose[off + SY] = poseA[off + SY];
    }
  }
}

/**
 * Masked additive: only apply additive to bones in mask.
 */
export function maskedAdditive(basePose, additivePose, weight, boneCount, boneMask) {
  const isSet = boneMask instanceof Set;
  for (let i = 0; i < boneCount; i++) {
    const masked = isSet ? boneMask.has(i) : boneMask[i];
    if (!masked) continue;
    const off = i * STRIDE;
    basePose[off + TX] += additivePose[off + TX] * weight;
    basePose[off + TY] += additivePose[off + TY] * weight;
    basePose[off + ROT] += additivePose[off + ROT] * weight;
    basePose[off + SX] *= 1 + (additivePose[off + SX] - 1) * weight;
    basePose[off + SY] *= 1 + (additivePose[off + SY] - 1) * weight;
  }
}
