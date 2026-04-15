/**
 * Inverse kinematics solvers.
 *
 * - 2-bone IK: for arms/legs — upper + lower bone reach toward a target.
 */

import { STRIDE, TX, TY, ROT, SX, SY } from './pose.js';

/**
 * 2-bone IK solver.
 *
 * Given two consecutive bones (upper, lower) and a target world position,
 * compute the joint angles that place the tip of the lower bone at (or closest to)
 * the target.
 *
 * Operates on the world pose. After solving, the world positions and rotations
 * of both bones are updated.
 *
 * @param {Float64Array} worldPose
 * @param {number} upperBoneIndex
 * @param {number} lowerBoneIndex
 * @param {number} upperLength — length of upper bone
 * @param {number} lowerLength — length of lower bone
 * @param {number} targetX — world target x
 * @param {number} targetY — world target y
 * @param {number} [bendDirection] — +1 or -1, controls which side the elbow bends
 * @param {number} [weight] — 0..1 blend toward IK solution
 */
export function solve2BoneIK(worldPose, upperBoneIndex, lowerBoneIndex, upperLength, lowerLength, targetX, targetY, bendDirection = 1, weight = 1) {
  const uOff = upperBoneIndex * STRIDE;
  const lOff = lowerBoneIndex * STRIDE;

  // Upper bone world position (pivot)
  const ux = worldPose[uOff + TX];
  const uy = worldPose[uOff + TY];

  // Distance to target
  const dx = targetX - ux;
  const dy = targetY - uy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  const a = upperLength;
  const b = lowerLength;
  const maxReach = a + b;

  // Angle from upper bone to target
  const aimAngle = Math.atan2(dy, dx);

  let upperAngle, elbowX, elbowY;

  if (dist >= maxReach - 0.001) {
    // Fully extended — both bones point at target
    upperAngle = aimAngle;
    elbowX = ux + Math.cos(aimAngle) * a;
    elbowY = uy + Math.sin(aimAngle) * a;
  } else if (dist < 0.001) {
    // Target on top of pivot — keep current
    return;
  } else {
    // Law of cosines to find the angle at the upper bone
    const cosUpper = (a * a + dist * dist - b * b) / (2 * a * dist);
    const clamped = Math.max(-1, Math.min(1, cosUpper));
    const upperOffset = Math.acos(clamped) * bendDirection;
    upperAngle = aimAngle + upperOffset;
    elbowX = ux + Math.cos(upperAngle) * a;
    elbowY = uy + Math.sin(upperAngle) * a;
  }

  // Lower bone always points from elbow to target
  const lowerAngle = Math.atan2(targetY - elbowY, targetX - elbowX);

  // Save originals for weight blending
  const origUpperRot = worldPose[uOff + ROT];
  const origLowerRot = worldPose[lOff + ROT];
  const origLowerX = worldPose[lOff + TX];
  const origLowerY = worldPose[lOff + TY];

  if (weight < 1) {
    let dU = upperAngle - origUpperRot;
    while (dU > Math.PI) dU -= Math.PI * 2;
    while (dU < -Math.PI) dU += Math.PI * 2;

    let dL = lowerAngle - origLowerRot;
    while (dL > Math.PI) dL -= Math.PI * 2;
    while (dL < -Math.PI) dL += Math.PI * 2;

    worldPose[uOff + ROT] = origUpperRot + dU * weight;
    worldPose[lOff + ROT] = origLowerRot + dL * weight;
    worldPose[lOff + TX] = origLowerX + (elbowX - origLowerX) * weight;
    worldPose[lOff + TY] = origLowerY + (elbowY - origLowerY) * weight;
  } else {
    worldPose[uOff + ROT] = upperAngle;
    worldPose[lOff + ROT] = lowerAngle;
    worldPose[lOff + TX] = elbowX;
    worldPose[lOff + TY] = elbowY;
  }
}
