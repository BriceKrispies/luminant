/**
 * Studio rig builder — creates creature rigs directly for studio control.
 *
 * Bypasses creature-model.js so the studio has direct control over
 * every aspect of the rig (animation state, expression, time, etc.).
 * Produces render models in the same shape drawCreature expects.
 */

import { ARCHETYPES, buildVariation } from '../src/renderer/creatures/archetypes.js';
import { createSkeleton, createPose, resetPose, addPose, solveWorldPose, POSE_STRIDE, PX, PY, PROT, PSX, PSY } from '../src/renderer/creatures/skeleton.js';
import { sampleClip } from '../src/renderer/creatures/animation.js';
import { createAnimController } from '../src/renderer/creatures/anim-controller.js';
import { createSlotLayout, resolveAttachments } from '../src/renderer/creatures/slots.js';
import { createOverlayStack, breathingOverlay, hoverBobOverlay, recoilOverlay, tensionOverlay, headLookOverlay, weaponFollowOverlay } from '../src/renderer/creatures/overlays.js';
import { createSecondary } from '../src/renderer/creatures/secondaries.js';
import { createExpressionController, detectExpression } from '../src/renderer/creatures/expression.js';
import { composeDeformations } from '../src/renderer/creatures/deformations.js';
import { SKELETON_DEFS, SLOT_DEFS, CLIP_DEFS, STATE_CONFIGS, EXPRESSION_PROFILES, OVERLAY_CONFIGS } from '../src/renderer/creatures/rig-data.js';
import { deriveProgressionState, createBurstState } from '../src/renderer/creatures/progression.js';

// Reverse map: archetype ID → entity type constant
const ARCHETYPE_TO_TYPE = { player: 1, slime: 2, ghost: 3, brute: 4, ember: 5 };

/**
 * Create a synthetic entity for studio use. No WASM needed.
 */
export function createSyntheticEntity(archetypeId, overrides = {}) {
  return {
    id: overrides.id || 1,
    type: ARCHETYPE_TO_TYPE[archetypeId] || 2,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    hp: 30,
    maxHp: 30,
    radius: 14,
    state: 1,
    facing: 0,
    damage: 8,
    speed: 60,
    ...overrides,
  };
}

/**
 * Create a studio rig — full control over all subsystems.
 */
export function createStudioRig(archetypeId, entityId = 1) {
  const archetype = ARCHETYPES[archetypeId];
  if (!archetype) throw new Error(`Unknown archetype: ${archetypeId}`);

  const skeleton = createSkeleton(archetypeId, SKELETON_DEFS[archetypeId]);
  const clips = CLIP_DEFS[archetypeId];
  const stateConfigs = JSON.parse(JSON.stringify(STATE_CONFIGS));
  const animController = createAnimController(stateConfigs, clips, 'idle');

  // Overlays
  const overlayStack = createOverlayStack();
  const overlayConfig = OVERLAY_CONFIGS[archetypeId] || {};
  if (overlayConfig.breathing) overlayStack.add(breathingOverlay(overlayConfig.breathing));
  if (overlayConfig.hover_bob) overlayStack.add(hoverBobOverlay(overlayConfig.hover_bob));
  overlayStack.add(recoilOverlay(overlayConfig.recoil || {}));
  if (overlayConfig.tension) overlayStack.add(tensionOverlay(overlayConfig.tension));
  overlayStack.add(headLookOverlay(overlayConfig.head_look || {}));
  overlayStack.add(weaponFollowOverlay());

  // Secondary motion
  const secondary = createSecondary(archetype.secondaryId || archetypeId);

  // Expression
  const exprProfile = EXPRESSION_PROFILES[archetype.expressionId || archetypeId];
  const exprController = exprProfile
    ? createExpressionController(exprProfile, entityId)
    : null;

  // Poses
  const localPose = createPose(skeleton);
  const worldPose = new Float64Array(skeleton.boneCount * POSE_STRIDE);
  const clipDelta = new Float64Array(skeleton.boneCount * POSE_STRIDE);
  const blendScratch = new Float64Array(skeleton.boneCount * POSE_STRIDE);

  // Variation
  const variation = buildVariation(archetype, entityId);

  // Slot layout
  const slotLayout = createSlotLayout(SLOT_DEFS[archetypeId], skeleton);

  // Track hit/death state
  let hitTimer = 0;
  let deathTimer = 0;

  // Progression
  const burstState = createBurstState();

  return {
    archetype,
    skeleton,
    animController,
    overlayStack,
    secondary,
    exprController,
    variation,
    slotLayout,
    clips,

    /**
     * Resolve into a render model.
     * The studio controls all inputs directly.
     */
    resolve(opts) {
      const {
        time = 0,
        dt = 1 / 60,
        entity,
        forceAnim = null,
        forceExpression = null,
        autoExpression = true,
        pupilX = 0,
        pupilY = 0,
        hitActive = false,
        paused = false,
        scrubTime = null,
        level = 1,
        xpProgress = 0,
        entitySeed = 0,
        progressionEnabled = true,
        progressionToggles = null,
        triggerBurst = false,
      } = opts;

      // Hit/death tracking
      if (hitActive && hitTimer <= 0) {
        hitTimer = archetype.deform.hit.flashDuration;
      }
      if (!paused) {
        hitTimer = Math.max(0, hitTimer - dt);
      }
      if (entity.state === 2) {
        deathTimer += paused ? 0 : dt;
      }

      // Update animation controller
      if (!paused) {
        if (forceAnim) {
          // Force a specific animation state
          const config = stateConfigs[forceAnim];
          if (config && config.next) {
            // One-shot
            animController.playOneShot(forceAnim);
          } else if (animController.state !== forceAnim) {
            animController.forceState(forceAnim, 0.05);
          }
        }
        animController.update(dt, entity);
      }

      // Reset and sample pose
      resetPose(skeleton, localPose);

      const playback = animController.getPlayback();

      // If scrubbing, override clip time
      let layers = playback.layers;
      if (paused && scrubTime !== null && layers.length > 0) {
        layers = layers.map(l => ({
          ...l,
          time: scrubTime * l.clip.duration,
        }));
      }

      if (layers.length === 1) {
        sampleClip(layers[0].clip, layers[0].time, skeleton, clipDelta);
        addPose(localPose, clipDelta, layers[0].weight);
      } else if (layers.length === 2) {
        sampleClip(layers[0].clip, layers[0].time, skeleton, clipDelta);
        addPose(localPose, clipDelta, layers[0].weight);
        sampleClip(layers[1].clip, layers[1].time, skeleton, blendScratch);
        addPose(localPose, blendScratch, layers[1].weight);
      }

      // Overlays
      overlayStack.setParams('breathing', { phase: variation.wobblePhase || 0 });
      if (overlayStack.ids.includes('hover_bob')) {
        overlayStack.setParams('hover_bob', { phase: variation.wobblePhase || 0 });
      }
      overlayStack.setParams('recoil', {
        intensity: hitTimer > 0 ? hitTimer / archetype.deform.hit.flashDuration : 0,
      });
      const speed = Math.sqrt(entity.vx * entity.vx + entity.vy * entity.vy);
      if (overlayStack.ids.includes('tension')) {
        overlayStack.setParams('tension', {
          intensity: speed > 20 ? Math.min((speed - 20) / 80, 1) : 0,
        });
      }
      if (speed > 5) {
        const velAngle = Math.atan2(entity.vy, entity.vx);
        overlayStack.setParams('head_look', { angle: velAngle - entity.facing, weight: 0.6 });
      } else {
        overlayStack.setParams('head_look', { angle: 0, weight: 0 });
      }
      overlayStack.applyAll(localPose, skeleton, time, dt);

      // Secondary motion
      if (secondary && !paused) {
        secondary.apply(localPose, skeleton, entity, time, dt, variation);
      }

      // Expression
      let expressionParams = null;
      if (exprController) {
        if (autoExpression && !forceExpression) {
          const exprName = detectExpression(entity, hitTimer, animController.state);
          exprController.setExpression(exprName);
        } else if (forceExpression) {
          exprController.setExpression(forceExpression);
        }
        if (!paused) exprController.update(dt);
        exprController.setPupilBias(pupilX, pupilY);
        expressionParams = exprController.getParams();
      }

      // World pose
      const rootScale = entity.radius * (variation.scaleJitter || 1);
      solveWorldPose(skeleton, localPose, worldPose, entity.x, entity.y, entity.facing, rootScale);

      // Slots
      const expressionOverrides = expressionParams?.attachmentOverrides || null;
      const resolvedSlots = resolveAttachments(slotLayout, null, expressionOverrides, null);

      // Legacy deform (for body shape wobble + flash + death effects)
      const animState = {
        state: entity.state === 2 ? 'dying' : (hitTimer > 0 ? 'hit' : (speed > 5 ? 'moving' : 'idle')),
        hitTimer,
        deathTimer,
      };
      const deform = composeDeformations(entity, time, archetype, variation, animState);

      // Progression
      if (triggerBurst) burstState.trigger();
      if (!paused) burstState.update(dt);

      const progression = progressionEnabled
        ? deriveProgressionState({
            archetypeId,
            level,
            time,
            xpProgress,
            entitySeed,
          })
        : null;

      const result = {
        archetype,
        variation,
        deform,
        skeleton,
        worldPose,
        resolvedSlots,
        expressionParams,
        animState: animController.state,
        progression,
        burstState: progressionEnabled ? burstState : null,
        progressionToggles,
        x: entity.x,
        y: entity.y,
        radius: entity.radius,
        facing: entity.facing,
        hp: entity.hp,
        maxHp: entity.maxHp,
        entityState: entity.state,
        useSkeleton: true,
      };
      this._lastModel = result;
      return result;
    },

    /** Reset animation and expression state */
    reset() {
      animController.reset();
      if (exprController) exprController.reset();
      hitTimer = 0;
      deathTimer = 0;
    },
  };
}
