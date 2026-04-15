/**
 * Pose system — local and world transform arrays for skeletal animation.
 *
 * A pose is a flat Float64Array: [tx, ty, rot, sx, sy] per bone.
 * STRIDE = 5. Indices: TX=0, TY=1, ROT=2, SX=3, SY=4.
 *
 * Local pose: transforms relative to parent bone.
 * World pose: absolute transforms after hierarchy evaluation.
 * Bind pose: the skeleton's rest configuration.
 */

export const STRIDE = 5;
export const TX = 0;
export const TY = 1;
export const ROT = 2;
export const SX = 3;
export const SY = 4;

/**
 * Allocate a pose array for a skeleton.
 */
export function createPose(boneCount) {
  return new Float64Array(boneCount * STRIDE);
}

/**
 * Reset a pose to the skeleton's bind pose.
 */
export function resetToBindPose(skeleton, pose) {
  const bones = skeleton.bones;
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i];
    const off = i * STRIDE;
    pose[off + TX] = b.localBindPosition.x;
    pose[off + TY] = b.localBindPosition.y;
    pose[off + ROT] = b.localBindRotation;
    pose[off + SX] = b.localBindScale.x;
    pose[off + SY] = b.localBindScale.y;
  }
}

/**
 * Copy src pose into dst.
 */
export function copyPose(dst, src) {
  dst.set(src);
}

/**
 * Compute world transforms from local transforms.
 * Root bones get an optional rootX, rootY, rootRotation, rootScale applied.
 * World pose format matches local: [tx, ty, rot, sx, sy] per bone,
 * but in absolute world coordinates.
 */
export function computeWorldPose(skeleton, localPose, worldPose, rootX = 0, rootY = 0, rootRot = 0, rootScale = 1) {
  const bones = skeleton.bones;
  for (let i = 0; i < bones.length; i++) {
    const off = i * STRIDE;
    const lx = localPose[off + TX];
    const ly = localPose[off + TY];
    const lr = localPose[off + ROT];
    const lsx = localPose[off + SX];
    const lsy = localPose[off + SY];
    const pi = bones[i].parentIndex;

    if (pi === -1) {
      // Root bone: apply root transform
      const cos = Math.cos(rootRot);
      const sin = Math.sin(rootRot);
      worldPose[off + TX] = rootX + (lx * cos - ly * sin) * rootScale;
      worldPose[off + TY] = rootY + (lx * sin + ly * cos) * rootScale;
      worldPose[off + ROT] = rootRot + lr;
      worldPose[off + SX] = lsx * rootScale;
      worldPose[off + SY] = lsy * rootScale;
    } else {
      // Child bone: compose with parent world transform
      const poff = pi * STRIDE;
      const px = worldPose[poff + TX];
      const py = worldPose[poff + TY];
      const pr = worldPose[poff + ROT];
      const psx = worldPose[poff + SX];
      const psy = worldPose[poff + SY];

      const cos = Math.cos(pr);
      const sin = Math.sin(pr);
      worldPose[off + TX] = px + (lx * psx * cos - ly * psy * sin);
      worldPose[off + TY] = py + (lx * psx * sin + ly * psy * cos);
      worldPose[off + ROT] = pr + lr;
      worldPose[off + SX] = psx * lsx;
      worldPose[off + SY] = psy * lsy;
    }
  }
}

/**
 * Apply local transform deltas to a pose (additive).
 * Translation and rotation are additive. Scale is multiplicative around 1.0.
 */
export function applyDelta(pose, deltaPose, weight = 1) {
  for (let i = 0; i < pose.length; i += STRIDE) {
    pose[i + TX] += deltaPose[i + TX] * weight;
    pose[i + TY] += deltaPose[i + TY] * weight;
    pose[i + ROT] += deltaPose[i + ROT] * weight;
    // Scale: delta is deviation from 1.0, apply multiplicatively
    pose[i + SX] *= 1 + (deltaPose[i + SX] - 1) * weight;
    pose[i + SY] *= 1 + (deltaPose[i + SY] - 1) * weight;
  }
}

/**
 * Get a specific bone's local transform from a pose.
 */
export function getBoneLocal(pose, boneIndex) {
  const off = boneIndex * STRIDE;
  return {
    x: pose[off + TX],
    y: pose[off + TY],
    rot: pose[off + ROT],
    sx: pose[off + SX],
    sy: pose[off + SY],
  };
}

/**
 * Set a specific bone's local transform in a pose.
 */
export function setBoneLocal(pose, boneIndex, x, y, rot, sx, sy) {
  const off = boneIndex * STRIDE;
  pose[off + TX] = x;
  pose[off + TY] = y;
  pose[off + ROT] = rot;
  pose[off + SX] = sx;
  pose[off + SY] = sy;
}
