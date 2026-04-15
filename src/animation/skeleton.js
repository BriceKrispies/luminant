/**
 * Skeleton data model and runtime.
 *
 * A skeleton is a hierarchy of bones. Each bone stores:
 *   name, parentIndex, length, localBindPosition, localBindRotation, localBindScale
 *
 * Bones are stored in topological order: parent before child.
 * Slots define draw layers attached to bones.
 * Mesh attachments hold vertices weighted to bones for skinning.
 */

// ── Bone creation ──

/**
 * Create a bone definition.
 * @param {string} name
 * @param {number} parentIndex — -1 for root
 * @param {number} length
 * @param {{x:number, y:number}} pos — local bind position
 * @param {number} rot — local bind rotation in radians
 * @param {{x:number, y:number}} scale — local bind scale
 */
export function bone(name, parentIndex, length, pos = { x: 0, y: 0 }, rot = 0, scale = { x: 1, y: 1 }) {
  return {
    name,
    parentIndex,
    length,
    localBindPosition: { x: pos.x, y: pos.y },
    localBindRotation: rot,
    localBindScale: { x: scale.x, y: scale.y },
  };
}

// ── Slot / draw layer ──

/**
 * A slot ties a visual attachment to a bone with a draw order.
 * @param {string} name
 * @param {number} boneIndex
 * @param {string} attachmentName — key into the attachment map
 * @param {number} order — draw z-order (lower first)
 */
export function slot(name, boneIndex, attachmentName, order = 0) {
  return { name, boneIndex, attachmentName, order };
}

// ── Mesh attachment ──

/**
 * Create a mesh attachment for skinning.
 * @param {string} name
 * @param {Float32Array|number[]} vertices — flat [x,y, x,y, ...] in bind space
 * @param {Uint16Array|number[]} indices — triangle indices
 * @param {Uint8Array|number[]} boneIndices — flat [b0,b1,b2,b3, ...] per vertex (4 per)
 * @param {Float32Array|number[]} boneWeights — flat [w0,w1,w2,w3, ...] per vertex (4 per)
 * @param {object} [meta] — optional color/region metadata
 */
export function meshAttachment(name, vertices, indices, boneIndices, boneWeights, meta = {}) {
  const vertCount = vertices.length / 2;
  return {
    name,
    type: 'mesh',
    vertices: Float32Array.from(vertices),
    indices: Uint16Array.from(indices),
    boneIndices: Uint8Array.from(boneIndices),
    boneWeights: Float32Array.from(boneWeights),
    vertexCount: vertCount,
    triangleCount: indices.length / 3,
    meta,
  };
}

/**
 * Create a region attachment (simple quad).
 * @param {string} name
 * @param {number} width
 * @param {number} height
 * @param {object} [meta] — color, etc.
 */
export function regionAttachment(name, width, height, meta = {}) {
  const hw = width / 2;
  const hh = height / 2;
  return {
    name,
    type: 'region',
    width,
    height,
    // Generate quad mesh in bind space
    vertices: Float32Array.from([-hw, -hh, hw, -hh, hw, hh, -hw, hh]),
    indices: Uint16Array.from([0, 1, 2, 0, 2, 3]),
    vertexCount: 4,
    triangleCount: 2,
    meta,
  };
}

// ── Skeleton creation ──

/**
 * Create a skeleton from an array of bone definitions.
 * Validates parent ordering (parents must appear before children).
 * @param {Array} bones — array of bone defs from bone()
 * @param {Array} [slots] — array of slot defs from slot()
 * @param {Map|Object} [attachments] — name -> attachment map
 */
export function createSkeleton(bones, slots = [], attachments = {}) {
  // Validate topology
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i];
    if (b.parentIndex >= i) {
      throw new Error(`Bone "${b.name}" at index ${i} has parent at ${b.parentIndex} — parent must come first`);
    }
    if (b.parentIndex < -1) {
      throw new Error(`Bone "${b.name}" has invalid parentIndex ${b.parentIndex}`);
    }
  }

  // Build name -> index lookup
  const boneMap = new Map();
  for (let i = 0; i < bones.length; i++) {
    boneMap.set(bones[i].name, i);
  }

  // Sort slots by draw order
  const sortedSlots = [...slots].sort((a, b) => a.order - b.order);

  return {
    bones,
    boneCount: bones.length,
    boneMap,
    slots: sortedSlots,
    attachments: attachments instanceof Map ? attachments : new Map(Object.entries(attachments)),
    getBoneIndex(name) {
      return boneMap.get(name) ?? -1;
    },
  };
}
