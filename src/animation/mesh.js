/**
 * Mesh data structures and utilities for skinned rendering.
 *
 * A SkinnedMesh holds bind-space vertices, triangle indices, and per-vertex
 * bone weights. The skinning module transforms these into screen-space.
 */

/**
 * Create a skinned mesh from raw data.
 *
 * @param {object} opts
 * @param {number[]} opts.vertices — flat [x,y, x,y, ...] in bind pose space
 * @param {number[]} opts.indices — triangle indices [i0,i1,i2, ...]
 * @param {number[]} opts.boneIndices — flat [b0,b1,b2,b3, ...] per vertex (4 influences)
 * @param {number[]} opts.boneWeights — flat [w0,w1,w2,w3, ...] per vertex (4 influences)
 * @param {string} [opts.color] — fill color
 * @param {string} [opts.strokeColor] — stroke color
 * @param {number} [opts.strokeWidth] — stroke width
 * @param {number} [opts.opacity] — 0..1
 */
export function createSkinnedMesh(opts) {
  const vertCount = opts.vertices.length / 2;
  return {
    bindVertices: Float32Array.from(opts.vertices),
    indices: Uint16Array.from(opts.indices),
    boneIndices: Uint8Array.from(opts.boneIndices),
    boneWeights: Float32Array.from(opts.boneWeights),
    vertexCount: vertCount,
    triangleCount: opts.indices.length / 3,
    // Preallocated output buffer for deformed vertices
    deformedVertices: new Float32Array(opts.vertices.length),
    // Visual properties
    color: opts.color || '#888',
    strokeColor: opts.strokeColor || null,
    strokeWidth: opts.strokeWidth || 0,
    opacity: opts.opacity !== undefined ? opts.opacity : 1,
  };
}

/**
 * Build a simple quad mesh attached to a single bone.
 * Useful for quick prototyping — all vertices weighted 100% to one bone.
 */
export function createQuadMesh(boneIndex, width, height, color = '#888', offsetX = 0, offsetY = 0) {
  const hw = width / 2;
  const hh = height / 2;
  return createSkinnedMesh({
    vertices: [
      offsetX - hw, offsetY - hh,
      offsetX + hw, offsetY - hh,
      offsetX + hw, offsetY + hh,
      offsetX - hw, offsetY + hh,
    ],
    indices: [0, 1, 2, 0, 2, 3],
    boneIndices: [
      boneIndex, 0, 0, 0,
      boneIndex, 0, 0, 0,
      boneIndex, 0, 0, 0,
      boneIndex, 0, 0, 0,
    ],
    boneWeights: [
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
    ],
    color,
  });
}

/**
 * Build a multi-bone mesh from a polygon outline with per-vertex weights.
 * Each entry in vertexDefs: { x, y, bones: [[boneIdx, weight], ...] }
 */
export function createWeightedMesh(vertexDefs, indices, color = '#888', opts = {}) {
  const vertices = [];
  const boneIndices = [];
  const boneWeights = [];

  for (const v of vertexDefs) {
    vertices.push(v.x, v.y);
    const bi = [0, 0, 0, 0];
    const bw = [0, 0, 0, 0];
    const bones = v.bones || [[0, 1]];
    for (let i = 0; i < Math.min(bones.length, 4); i++) {
      bi[i] = bones[i][0];
      bw[i] = bones[i][1];
    }
    boneIndices.push(...bi);
    boneWeights.push(...bw);
  }

  return createSkinnedMesh({
    vertices,
    indices,
    boneIndices,
    boneWeights,
    color,
    ...opts,
  });
}
