/**
 * Animation runtime — orchestrates the full animation pipeline per entity.
 *
 * Runtime order:
 *   1. Read entity snapshot / presentation state
 *   2. Build animation parameters (via rig controller)
 *   3. Sample base clips
 *   4. Blend clips (crossfade)
 *   5. Apply additive layers (procedural overrides)
 *   6. Apply procedural overrides
 *   7. Solve constraints / IK
 *   8. Compute world bone transforms
 *   9. Skin mesh
 *  10. (Render — handled externally)
 */

import { createPose, resetToBindPose, copyPose, computeWorldPose, STRIDE, TX, TY, ROT, SX, SY } from './pose.js';
import { sampleClip } from './sampler.js';
import { blendPoses, applyAdditive } from './blend.js';
import { skinMeshes } from './skinning.js';
import { aimConstraint, trailConstraint, createTrailState } from './constraints.js';
import { createRigController } from './rig-controller.js';

/**
 * Create an animation runtime instance for one entity.
 *
 * @param {object} skeleton — skeleton from createSkeleton()
 * @param {object} clips — { idle, drift, chase, ... } clip map
 * @param {object[]} meshes — array of SkinnedMesh objects
 * @param {object} rigConfig — config for the rig controller
 * @param {object} [constraintConfig] — optional constraint setup
 */
export function createAnimRuntime(skeleton, clips, meshes, rigConfig = {}, constraintConfig = {}) {
  const bc = skeleton.boneCount;

  // Pose buffers — preallocated, reused each frame
  const bindPose = createPose(bc);
  const localPose = createPose(bc);
  const clipPoseA = createPose(bc);
  const clipPoseB = createPose(bc);
  const additivePose = createPose(bc);
  const worldPose = createPose(bc);

  // Initialize bind pose
  resetToBindPose(skeleton, bindPose);

  // Rig controller
  const controller = createRigController(clips, rigConfig);

  // Trail constraint state for cloth/robe chains
  const trailChains = [];
  if (constraintConfig.trails) {
    for (const chain of constraintConfig.trails) {
      const indices = chain.bones.map(name => skeleton.getBoneIndex(name)).filter(i => i !== -1);
      trailChains.push({
        boneIndices: indices,
        state: createTrailState(indices.length),
        stiffness: chain.stiffness || 0.25,
      });
    }
  }

  // Look constraint config
  const lookBoneIndex = constraintConfig.lookBone ?
    skeleton.getBoneIndex(constraintConfig.lookBone) : -1;

  return {
    skeleton,
    meshes,
    controller,
    worldPose,

    /**
     * Run the full animation pipeline for one frame.
     *
     * @param {object} entity — entity snapshot
     * @param {number} dt — frame delta seconds
     * @param {number} gameTime — total game time
     * @returns {object} — { worldPose, meshes (with deformedVertices), animState }
     */
    update(entity, dt, gameTime) {
      // 1-2. Controller produces animation parameters
      const params = controller.update(entity, dt, gameTime);

      // 3. Sample base clip into localPose
      resetToBindPose(skeleton, localPose);
      resetToBindPose(skeleton, clipPoseA);

      if (params.baseClip) {
        sampleClip(params.baseClip, params.baseTime, skeleton, clipPoseA);
      }

      // 4. Blend with crossfade source if active
      if (params.crossfadeFromClip && params.crossfadeWeight > 0) {
        sampleClip(params.crossfadeFromClip, params.crossfadeFromTime, skeleton, clipPoseB);
        blendPoses(clipPoseB, clipPoseA, params.baseWeight, localPose, bc);
      } else {
        copyPose(localPose, clipPoseA);
      }

      // 5-6. Apply procedural overrides as additive
      additivePose.fill(0);
      // Set scale channels to 1 (neutral for additive)
      for (let i = 0; i < bc; i++) {
        additivePose[i * STRIDE + SX] = 1;
        additivePose[i * STRIDE + SY] = 1;
      }

      // Hover offset on root
      const rootIdx = 0; // root is always index 0
      additivePose[rootIdx * STRIDE + TY] += params.hoverOffset;

      // Torso lean
      const torsoIdx = skeleton.getBoneIndex('torso');
      if (torsoIdx !== -1) {
        additivePose[torsoIdx * STRIDE + ROT] += params.torsoLean;
      }

      // Head lag
      const headIdx = skeleton.getBoneIndex('head');
      if (headIdx !== -1) {
        additivePose[headIdx * STRIDE + ROT] += params.headLagRotation;
      }

      // Recoil on torso
      if (torsoIdx !== -1 && params.recoilIntensity > 0) {
        additivePose[torsoIdx * STRIDE + TY] += params.recoilIntensity * 1.5;
        additivePose[torsoIdx * STRIDE + SX] = 1 + params.recoilIntensity * 0.05;
        additivePose[torsoIdx * STRIDE + SY] = 1 - params.recoilIntensity * 0.03;
      }

      // Robe/cloth drag on trail bones — stronger drag for visible trailing
      for (const chain of trailChains) {
        for (let i = 0; i < chain.boneIndices.length; i++) {
          const bi = chain.boneIndices[i];
          const dragFactor = (i + 1) / chain.boneIndices.length;
          additivePose[bi * STRIDE + TX] -= params.dragVx * 0.025 * dragFactor;
          additivePose[bi * STRIDE + TY] -= params.dragVy * 0.025 * dragFactor;
          additivePose[bi * STRIDE + ROT] += params.dragVx * 0.003 * dragFactor;
        }
      }

      // Arm sway — independent sinusoidal overlay at different frequencies
      const lUpperArmIdx = skeleton.getBoneIndex('left_upper_arm');
      const rUpperArmIdx = skeleton.getBoneIndex('right_upper_arm');
      const lLowerArmIdx = skeleton.getBoneIndex('left_lower_arm');
      const rLowerArmIdx = skeleton.getBoneIndex('right_lower_arm');
      if (lUpperArmIdx !== -1) {
        additivePose[lUpperArmIdx * STRIDE + ROT] += Math.sin(gameTime * 1.7) * 0.12;
      }
      if (rUpperArmIdx !== -1) {
        additivePose[rUpperArmIdx * STRIDE + ROT] += Math.sin(gameTime * 1.9 + 1.8) * 0.12;
      }
      if (lLowerArmIdx !== -1) {
        additivePose[lLowerArmIdx * STRIDE + ROT] += Math.sin(gameTime * 2.3 + 0.5) * 0.08;
      }
      if (rLowerArmIdx !== -1) {
        additivePose[rLowerArmIdx * STRIDE + ROT] += Math.sin(gameTime * 2.1 + 2.3) * 0.08;
      }

      // Hand/claw accent motion — faster, more pronounced
      const lHandIdx = skeleton.getBoneIndex('left_hand');
      const rHandIdx = skeleton.getBoneIndex('right_hand');
      if (lHandIdx !== -1) {
        additivePose[lHandIdx * STRIDE + ROT] += Math.sin(gameTime * 3.5) * 0.18;
      }
      if (rHandIdx !== -1) {
        additivePose[rHandIdx * STRIDE + ROT] += Math.sin(gameTime * 3.5 + 2) * 0.18;
      }

      // Hair lag — trails behind movement
      const hairIdx = skeleton.getBoneIndex('hair');
      if (hairIdx !== -1) {
        additivePose[hairIdx * STRIDE + ROT] -= params.dragVx * 0.005;
      }

      applyAdditive(localPose, additivePose, 1, bc);

      // 8. Compute world pose
      const rootScale = entity.radius || 10;
      computeWorldPose(skeleton, localPose, worldPose,
        entity.x, entity.y, entity.facing, rootScale / 10);

      // 7. Solve constraints (after world pose)

      // Aim/look constraint
      if (lookBoneIndex !== -1 && params.lookWeight > 0) {
        const lookDist = 100;
        const lookX = entity.x + Math.cos(params.lookAngle) * lookDist;
        const lookY = entity.y + Math.sin(params.lookAngle) * lookDist;
        aimConstraint(worldPose, lookBoneIndex, lookX, lookY, params.lookWeight, -Math.PI / 2);
      }

      // Trail constraints (cloth/robe)
      for (const chain of trailChains) {
        trailConstraint(worldPose, chain.boneIndices, chain.state, chain.stiffness, dt);
      }

      // 9. Skin meshes
      skinMeshes(meshes, worldPose, skeleton);

      return {
        worldPose,
        meshes,
        skeleton,
        animState: params.state,
        facing: params.facing,
        isDying: params.isDying,
        recoilIntensity: params.recoilIntensity,
      };
    },

    /**
     * Reset the runtime (new entity spawn, etc.)
     */
    reset() {
      controller.reset();
      for (const chain of trailChains) {
        chain.state.fill(NaN);
      }
    },
  };
}
