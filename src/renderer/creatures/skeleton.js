/**
 * Skeleton and pose runtime for procedural creatures.
 *
 * A skeleton is an ordered list of bones with parent-child relationships.
 * A pose is a flat Float64Array storing per-bone local transforms.
 * World transforms are computed by walking the hierarchy root-to-leaf.
 *
 * Designed for top-down 2D: each bone has (x, y, rotation, scaleX, scaleY).
 * 5 floats per bone in the pose array.
 *
 * Performance: poses are pre-allocated flat arrays. No per-frame allocations
 * after initial skeleton creation. World transform solve is a single linear pass.
 */

const POSE_STRIDE = 5; // x, y, rot, sx, sy per bone
const PX = 0, PY = 1, PROT = 2, PSX = 3, PSY = 4;

// ── Bone ──

/**
 * @typedef {Object} BoneDef
 * @property {string} name
 * @property {string|null} parent — parent bone name, null for root
 * @property {number} x — default local X offset
 * @property {number} y — default local Y offset
 * @property {number} rotation — default local rotation (radians)
 * @property {number} [scaleX=1]
 * @property {number} [scaleY=1]
 * @property {string} [tags] — comma-separated tags for grouping (e.g., 'face,anchor')
 */

// ── Skeleton ──

/**
 * Create a skeleton from an array of bone definitions.
 * Bones must be ordered so parents appear before children.
 *
 * @param {string} id — skeleton identifier
 * @param {BoneDef[]} boneDefs
 * @returns {Skeleton}
 */
export function createSkeleton(id, boneDefs) {
  const bones = [];
  const nameToIndex = {};

  for (let i = 0; i < boneDefs.length; i++) {
    const def = boneDefs[i];
    const parentIdx = def.parent ? nameToIndex[def.parent] : -1;
    if (def.parent && parentIdx === undefined) {
      throw new Error(`Bone "${def.name}" references unknown parent "${def.parent}"`);
    }

    nameToIndex[def.name] = i;
    bones.push({
      name: def.name,
      index: i,
      parentIndex: parentIdx !== undefined ? parentIdx : -1,
      defaultX: def.x || 0,
      defaultY: def.y || 0,
      defaultRot: def.rotation || 0,
      defaultSX: def.scaleX !== undefined ? def.scaleX : 1,
      defaultSY: def.scaleY !== undefined ? def.scaleY : 1,
      tags: def.tags || '',
    });
  }

  return {
    id,
    bones,
    boneCount: bones.length,
    nameToIndex,

    /** Get bone index by name, or -1 */
    getBoneIndex(name) {
      const idx = nameToIndex[name];
      return idx !== undefined ? idx : -1;
    },

    /** Get bone by name */
    getBone(name) {
      const idx = nameToIndex[name];
      return idx !== undefined ? bones[idx] : null;
    },

    /** Check if a bone has a specific tag */
    boneHasTag(boneIndex, tag) {
      return bones[boneIndex].tags.includes(tag);
    },
  };
}

// ── Pose ──

/**
 * Create a new pose for a skeleton, initialized to the skeleton's default transforms.
 * @param {Skeleton} skeleton
 * @returns {Float64Array}
 */
export function createPose(skeleton) {
  const pose = new Float64Array(skeleton.boneCount * POSE_STRIDE);
  resetPose(skeleton, pose);
  return pose;
}

/**
 * Reset a pose to the skeleton's default bone transforms.
 */
export function resetPose(skeleton, pose) {
  for (let i = 0; i < skeleton.boneCount; i++) {
    const b = skeleton.bones[i];
    const off = i * POSE_STRIDE;
    pose[off + PX] = b.defaultX;
    pose[off + PY] = b.defaultY;
    pose[off + PROT] = b.defaultRot;
    pose[off + PSX] = b.defaultSX;
    pose[off + PSY] = b.defaultSY;
  }
}

/**
 * Copy pose src into dst.
 */
export function copyPose(dst, src) {
  dst.set(src);
}

/**
 * Blend two poses: result = a * (1-t) + b * t
 * Rotation is lerped (not slerp — fine for small angles in 2D).
 */
export function blendPoses(out, a, b, t) {
  const inv = 1 - t;
  for (let i = 0; i < out.length; i++) {
    out[i] = a[i] * inv + b[i] * t;
  }
}

/**
 * Apply an additive pose delta on top of a base pose.
 * For translation/rotation: base + delta
 * For scale: base * delta (delta centered at 1.0)
 */
export function addPose(base, delta, weight = 1) {
  const len = base.length;
  for (let i = 0; i < len; i += POSE_STRIDE) {
    base[i + PX] += delta[i + PX] * weight;
    base[i + PY] += delta[i + PY] * weight;
    base[i + PROT] += delta[i + PROT] * weight;
    // Scale is multiplicative: blend toward delta's deviation from 1.0
    base[i + PSX] *= 1 + (delta[i + PSX] - 1) * weight;
    base[i + PSY] *= 1 + (delta[i + PSY] - 1) * weight;
  }
}

// ── World Transform Solver ──

/**
 * Solve world-space transforms from a local pose.
 * Output is a flat Float64Array: [worldX, worldY, worldRot, worldSX, worldSY] per bone.
 *
 * @param {Skeleton} skeleton
 * @param {Float64Array} localPose
 * @param {Float64Array} worldPose — output, same layout as localPose
 * @param {number} rootX — entity world X
 * @param {number} rootY — entity world Y
 * @param {number} rootRot — entity facing rotation
 * @param {number} rootScale — entity base scale
 */
export function solveWorldPose(skeleton, localPose, worldPose, rootX, rootY, rootRot, rootScale) {
  for (let i = 0; i < skeleton.boneCount; i++) {
    const bone = skeleton.bones[i];
    const off = i * POSE_STRIDE;

    const lx = localPose[off + PX];
    const ly = localPose[off + PY];
    const lr = localPose[off + PROT];
    const lsx = localPose[off + PSX];
    const lsy = localPose[off + PSY];

    if (bone.parentIndex === -1) {
      // Root bone: apply entity transform
      const cos = Math.cos(rootRot);
      const sin = Math.sin(rootRot);
      worldPose[off + PX] = rootX + (lx * cos - ly * sin) * rootScale;
      worldPose[off + PY] = rootY + (lx * sin + ly * cos) * rootScale;
      worldPose[off + PROT] = rootRot + lr;
      worldPose[off + PSX] = rootScale * lsx;
      worldPose[off + PSY] = rootScale * lsy;
    } else {
      // Child bone: inherit parent world transform
      const pOff = bone.parentIndex * POSE_STRIDE;
      const px = worldPose[pOff + PX];
      const py = worldPose[pOff + PY];
      const pr = worldPose[pOff + PROT];
      const psx = worldPose[pOff + PSX];
      const psy = worldPose[pOff + PSY];

      const cos = Math.cos(pr);
      const sin = Math.sin(pr);
      worldPose[off + PX] = px + (lx * cos - ly * sin) * psx;
      worldPose[off + PY] = py + (lx * sin + ly * cos) * psy;
      worldPose[off + PROT] = pr + lr;
      worldPose[off + PSX] = psx * lsx;
      worldPose[off + PSY] = psy * lsy;
    }
  }
}

// ── Pose accessors ──

export function getPoseBone(pose, boneIndex) {
  const off = boneIndex * POSE_STRIDE;
  return {
    x: pose[off + PX],
    y: pose[off + PY],
    rotation: pose[off + PROT],
    scaleX: pose[off + PSX],
    scaleY: pose[off + PSY],
  };
}

export function setPoseBone(pose, boneIndex, x, y, rotation, scaleX, scaleY) {
  const off = boneIndex * POSE_STRIDE;
  pose[off + PX] = x;
  pose[off + PY] = y;
  pose[off + PROT] = rotation;
  pose[off + PSX] = scaleX !== undefined ? scaleX : 1;
  pose[off + PSY] = scaleY !== undefined ? scaleY : 1;
}

export function setPoseBonePartial(pose, boneIndex, values) {
  const off = boneIndex * POSE_STRIDE;
  if (values.x !== undefined) pose[off + PX] = values.x;
  if (values.y !== undefined) pose[off + PY] = values.y;
  if (values.rotation !== undefined) pose[off + PROT] = values.rotation;
  if (values.scaleX !== undefined) pose[off + PSX] = values.scaleX;
  if (values.scaleY !== undefined) pose[off + PSY] = values.scaleY;
}

// ── Constants ──

export { POSE_STRIDE, PX, PY, PROT, PSX, PSY };
