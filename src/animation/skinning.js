/**
 * CPU mesh skinning — transforms bind-space vertices to world space
 * using weighted bone influences from the current world pose.
 *
 * For each vertex, up to 4 bone influences are applied:
 *   finalPos = sum(weight_i * boneTransform_i * bindPos)
 *
 * This produces deformed vertex positions for Canvas 2D rendering.
 */

import { STRIDE, TX, TY, ROT, SX, SY } from './pose.js';

/**
 * Skin a mesh: transform bind-space vertices by weighted bone influences.
 *
 * Writes deformed positions into mesh.deformedVertices.
 *
 * Each bone transform is: translate to world, rotate, scale.
 * We need the full bone world matrix, but since we're 2D we can inline it:
 *   worldX = boneWX + (vx * sx * cos(r) - vy * sy * sin(r))
 *   worldY = boneWY + (vx * sx * sin(r) + vy * sy * cos(r))
 *
 * The bind-pose vertex is relative to the bone's bind-space origin.
 * We need to transform from bind space to bone-local, then to world.
 * For simplicity, bind vertices are already in bone-local space
 * (authored relative to the bone they're weighted to).
 *
 * @param {object} mesh — from createSkinnedMesh
 * @param {Float64Array} worldPose — current world pose
 * @param {object} skeleton — for bone count validation
 */
export function skinMesh(mesh, worldPose, skeleton) {
  const verts = mesh.bindVertices;
  const out = mesh.deformedVertices;
  const bi = mesh.boneIndices;
  const bw = mesh.boneWeights;
  const vc = mesh.vertexCount;

  for (let v = 0; v < vc; v++) {
    const vx = verts[v * 2];
    const vy = verts[v * 2 + 1];
    const wi = v * 4; // weight/bone index offset

    let outX = 0;
    let outY = 0;

    for (let j = 0; j < 4; j++) {
      const w = bw[wi + j];
      if (w <= 0) continue;

      const boneIdx = bi[wi + j];
      const boff = boneIdx * STRIDE;
      const bx = worldPose[boff + TX];
      const by = worldPose[boff + TY];
      const br = worldPose[boff + ROT];
      const bsx = worldPose[boff + SX];
      const bsy = worldPose[boff + SY];

      const cos = Math.cos(br);
      const sin = Math.sin(br);
      const tx = bx + (vx * bsx * cos - vy * bsy * sin);
      const ty = by + (vx * bsx * sin + vy * bsy * cos);

      outX += tx * w;
      outY += ty * w;
    }

    out[v * 2] = outX;
    out[v * 2 + 1] = outY;
  }
}

/**
 * Skin multiple meshes in batch.
 * @param {object[]} meshes — array of skinned meshes
 * @param {Float64Array} worldPose
 * @param {object} skeleton
 */
export function skinMeshes(meshes, worldPose, skeleton) {
  for (const mesh of meshes) {
    skinMesh(mesh, worldPose, skeleton);
  }
}
