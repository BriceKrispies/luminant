/**
 * Creature model resolver — skeleton-based pipeline.
 *
 * Resolves entity snapshot + time into a complete render model using:
 *   skeleton → animation controller → clip sampling → overlays →
 *   secondary motion → expression → world pose → slot resolution
 *
 * Per-entity runtime instances are cached (skeleton, anim controller,
 * overlay stack, secondary module, expression controller). No per-frame
 * allocations after warmup.
 *
 * Falls back to the legacy deformation pipeline for entities whose
 * archetype has no skeleton definition.
 */

import { getArchetype, buildVariation } from './archetypes.js';
import { composeDeformations, detectAnimState } from './deformations.js';
import { createSkeleton, createPose, resetPose, addPose, blendPoses, solveWorldPose, POSE_STRIDE, PX, PY, PROT, PSX, PSY } from './skeleton.js';
import { sampleClip } from './animation.js';
import { createAnimController } from './anim-controller.js';
import { createSlotLayout, resolveAttachments } from './slots.js';
import { createOverlayStack } from './overlays.js';
import { breathingOverlay, hoverBobOverlay, recoilOverlay, tensionOverlay, headLookOverlay, weaponFollowOverlay } from './overlays.js';
import { createSecondary } from './secondaries.js';
import { createExpressionController, detectExpression } from './expression.js';
import { SKELETON_DEFS, SLOT_DEFS, CLIP_DEFS, STATE_CONFIGS, EXPRESSION_PROFILES, OVERLAY_CONFIGS } from './rig-data.js';

const TAU = Math.PI * 2;

/**
 * Create a creature model resolver.
 * One instance per renderer — caches per-entity runtime state.
 */
export function createCreatureResolver() {
  // Per-entity caches
  const variationCache = new Map();
  const hitState = new Map();
  const deathState = new Map();
  const rigCache = new Map(); // entityId → rig runtime instance

  // Per-archetype shared skeleton/slot layout (created once per archetype)
  const skeletonCache = {};
  const slotLayoutCache = {};

  // Reusable scratch arrays per skeleton (keyed by bone count)
  const scratchPoses = {};

  function getOrCreateSkeleton(archetypeId) {
    if (skeletonCache[archetypeId]) return skeletonCache[archetypeId];
    const boneDefs = SKELETON_DEFS[archetypeId];
    if (!boneDefs) return null;
    const skeleton = createSkeleton(archetypeId, boneDefs);
    skeletonCache[archetypeId] = skeleton;
    return skeleton;
  }

  function getOrCreateSlotLayout(archetypeId, skeleton) {
    if (slotLayoutCache[archetypeId]) return slotLayoutCache[archetypeId];
    const slotDefs = SLOT_DEFS[archetypeId];
    if (!slotDefs) return null;
    const layout = createSlotLayout(slotDefs, skeleton);
    slotLayoutCache[archetypeId] = layout;
    return layout;
  }

  function getScratchPose(boneCount) {
    if (!scratchPoses[boneCount]) {
      scratchPoses[boneCount] = {
        clipDelta: new Float64Array(boneCount * POSE_STRIDE),
        blendScratch: new Float64Array(boneCount * POSE_STRIDE),
      };
    }
    return scratchPoses[boneCount];
  }

  /**
   * Create per-entity rig runtime: anim controller, overlays, secondary, expression.
   */
  function createRig(archetype, entityId) {
    const arcId = archetype.id;
    const skeleton = getOrCreateSkeleton(arcId);
    if (!skeleton) return null;

    const clips = CLIP_DEFS[arcId];
    if (!clips) return null;

    // Animation controller
    const animController = createAnimController(
      // Clone state configs so one-shot next pointers don't leak between entities
      JSON.parse(JSON.stringify(STATE_CONFIGS)),
      clips,
      'idle'
    );

    // Overlay stack
    const overlayStack = createOverlayStack();
    const overlayConfig = OVERLAY_CONFIGS[arcId] || {};
    if (overlayConfig.breathing) overlayStack.add(breathingOverlay(overlayConfig.breathing));
    if (overlayConfig.hover_bob) overlayStack.add(hoverBobOverlay(overlayConfig.hover_bob));
    overlayStack.add(recoilOverlay(overlayConfig.recoil || {}));
    if (overlayConfig.tension) overlayStack.add(tensionOverlay(overlayConfig.tension));
    overlayStack.add(headLookOverlay(overlayConfig.head_look || {}));
    overlayStack.add(weaponFollowOverlay());

    // Secondary motion
    const secondary = createSecondary(archetype.secondaryId || arcId);

    // Expression controller
    const exprProfile = EXPRESSION_PROFILES[archetype.expressionId || arcId];
    const exprController = exprProfile
      ? createExpressionController(exprProfile, entityId)
      : null;

    // Per-entity poses (allocated once)
    const localPose = createPose(skeleton);
    const worldPose = new Float64Array(skeleton.boneCount * POSE_STRIDE);

    return {
      skeleton,
      animController,
      overlayStack,
      secondary,
      exprController,
      localPose,
      worldPose,
    };
  }

  // Reusable animation state object
  const _animState = { state: 'idle', hitTimer: 0, deathTimer: 0 };

  return {
    /**
     * Resolve an entity into a creature render model.
     * Returns null for non-enemy types.
     */
    resolve(entity, time, dt) {
      const archetype = getArchetype(entity.type);
      if (!archetype) return null;

      // Per-entity variation
      let variation = variationCache.get(entity.id);
      if (!variation) {
        variation = buildVariation(archetype, entity.id);
        variationCache.set(entity.id, variation);
      }

      // Hit state tracking
      let hs = hitState.get(entity.id);
      if (!hs) {
        hs = { lastHp: entity.hp, hitTimer: 0 };
        hitState.set(entity.id, hs);
      }
      if (entity.hp < hs.lastHp && entity.state !== 2) {
        hs.hitTimer = archetype.deform.hit.flashDuration;
      }
      hs.lastHp = entity.hp;
      hs.hitTimer = Math.max(0, hs.hitTimer - dt);

      // Death state tracking
      let ds = deathState.get(entity.id);
      if (entity.state === 2) {
        if (!ds) {
          ds = { deathTimer: 0 };
          deathState.set(entity.id, ds);
        }
        ds.deathTimer += dt;
      }

      // Animation state
      _animState.state = detectAnimState(entity, hs.hitTimer);
      _animState.hitTimer = hs.hitTimer;
      _animState.deathTimer = ds ? ds.deathTimer : 0;

      // Facing
      const facing = entity.facing !== undefined && entity.facing !== 0
        ? entity.facing
        : Math.atan2(entity.vy, entity.vx);

      // Try skeleton-based pipeline
      let rig = rigCache.get(entity.id);
      if (rig === undefined) {
        rig = createRig(archetype, entity.id);
        rigCache.set(entity.id, rig); // null if no skeleton — use legacy
      }

      if (rig) {
        return this._resolveRig(rig, entity, archetype, variation, time, dt, facing, hs, ds);
      }

      // Legacy fallback — deformation-based pipeline
      return this._resolveLegacy(entity, archetype, variation, time, dt, facing, ds);
    },

    /**
     * Skeleton-based resolve pipeline.
     */
    _resolveRig(rig, entity, archetype, variation, time, dt, facing, hs, ds) {
      const { skeleton, animController, overlayStack, secondary, exprController, localPose, worldPose } = rig;
      const scratch = getScratchPose(skeleton.boneCount);

      // 1. Update animation controller
      animController.update(dt, entity);

      // Trigger one-shots from game state
      if (hs.hitTimer > 0 && hs.hitTimer >= archetype.deform.hit.flashDuration - dt * 1.5) {
        animController.playOneShot('hit_react');
      }

      // 2. Reset pose to skeleton defaults
      resetPose(skeleton, localPose);

      // 3. Sample animation clips into pose
      const playback = animController.getPlayback();
      if (playback.layers.length === 1) {
        // Single clip — sample directly
        const layer = playback.layers[0];
        sampleClip(layer.clip, layer.time, skeleton, scratch.clipDelta);
        addPose(localPose, scratch.clipDelta, layer.weight);
      } else if (playback.layers.length === 2) {
        // Crossfade — sample both and blend
        const a = playback.layers[0];
        const b = playback.layers[1];
        sampleClip(a.clip, a.time, skeleton, scratch.clipDelta);
        addPose(localPose, scratch.clipDelta, a.weight);
        sampleClip(b.clip, b.time, skeleton, scratch.blendScratch);
        addPose(localPose, scratch.blendScratch, b.weight);
      }

      // 4. Apply overlays
      // Update overlay params from game state
      overlayStack.setParams('breathing', { phase: variation.wobblePhase || 0 });
      if (overlayStack.ids.includes('hover_bob')) {
        overlayStack.setParams('hover_bob', { phase: variation.wobblePhase || 0 });
      }
      overlayStack.setParams('recoil', {
        intensity: hs.hitTimer > 0 ? hs.hitTimer / archetype.deform.hit.flashDuration : 0,
      });
      // Tension when chasing
      const speed = Math.sqrt(entity.vx * entity.vx + entity.vy * entity.vy);
      if (overlayStack.ids.includes('tension')) {
        overlayStack.setParams('tension', {
          intensity: speed > 20 ? Math.min((speed - 20) / 80, 1) : 0,
        });
      }
      // Head look toward velocity direction
      if (speed > 5) {
        const velAngle = Math.atan2(entity.vy, entity.vx);
        const lookAngle = velAngle - facing;
        overlayStack.setParams('head_look', { angle: lookAngle, weight: 0.6 });
      } else {
        overlayStack.setParams('head_look', { angle: 0, weight: 0 });
      }

      overlayStack.applyAll(localPose, skeleton, time, dt);

      // 5. Apply secondary motion
      if (secondary) {
        secondary.apply(localPose, skeleton, entity, time, dt, variation);
      }

      // 6. Update expression
      let expressionParams = null;
      if (exprController) {
        const exprName = detectExpression(entity, hs.hitTimer, animController.state);
        exprController.setExpression(exprName);
        exprController.update(dt);

        // Pupil bias toward velocity
        if (speed > 5) {
          const vAngle = Math.atan2(entity.vy, entity.vx) - facing;
          exprController.setPupilBias(Math.cos(vAngle) * 0.5, Math.sin(vAngle) * 0.5);
        } else {
          exprController.setPupilBias(0, 0);
        }

        expressionParams = exprController.getParams();
      }

      // 7. Solve world transforms
      const rootScale = entity.radius * (variation.scaleJitter || 1);
      solveWorldPose(skeleton, localPose, worldPose, entity.x, entity.y, facing, rootScale);

      // 8. Resolve slot attachments
      const slotLayout = getOrCreateSlotLayout(archetype.id, skeleton);
      const expressionOverrides = expressionParams?.attachmentOverrides || null;
      const resolvedSlots = slotLayout
        ? resolveAttachments(slotLayout, null, expressionOverrides, null)
        : [];

      // Legacy deformation for body shape wobble (still used by draw layer)
      const deform = composeDeformations(entity, time, archetype, variation, _animState);

      return {
        archetype,
        variation,
        deform,
        // Skeleton pipeline outputs
        skeleton,
        worldPose,
        resolvedSlots,
        expressionParams,
        animState: animController.state,
        // Position
        x: entity.x,
        y: entity.y,
        radius: entity.radius,
        facing,
        // HP
        hp: entity.hp,
        maxHp: entity.maxHp,
        entityState: entity.state,
        // Flag for draw layer
        useSkeleton: true,
      };
    },

    /**
     * Legacy deformation-based resolve (fallback when no skeleton data exists).
     */
    _resolveLegacy(entity, archetype, variation, time, dt, facing, ds) {
      const deform = composeDeformations(entity, time, archetype, variation, _animState);

      return {
        archetype,
        variation,
        deform,
        x: entity.x,
        y: entity.y + deform.yOffset,
        radius: entity.radius,
        facing,
        hp: entity.hp,
        maxHp: entity.maxHp,
        entityState: entity.state,
        useSkeleton: false,
      };
    },

    /**
     * Clean up caches for entities that no longer exist.
     */
    prune(activeIds) {
      if (variationCache.size > activeIds.size * 2) {
        for (const id of variationCache.keys()) {
          if (!activeIds.has(id)) {
            variationCache.delete(id);
            hitState.delete(id);
            deathState.delete(id);
            rigCache.delete(id);
          }
        }
      }
    },

    /** Clear all caches */
    reset() {
      variationCache.clear();
      hitState.clear();
      deathState.clear();
      rigCache.clear();
    },
  };
}
