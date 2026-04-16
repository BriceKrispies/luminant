/**
 * Additive animation overlays.
 *
 * Overlays are lightweight procedural or clip-based modifiers applied
 * on top of the base pose after clip sampling. Each overlay modifies
 * specific bones additively.
 *
 * Overlays are composable: multiple overlays can stack on the same bones.
 * Each overlay has a weight (0-1) for blending.
 *
 * Built-in overlays:
 *   - breathing — rhythmic chest/body scale pulse
 *   - hover_bob — vertical oscillation for floating creatures
 *   - recoil — brief backward jolt on hit
 *   - tension — forward lean during chase/aggression
 *   - head_look — subtle head bone rotation toward target
 *   - weapon_follow — weapon bone follow-through after attack
 */

import { POSE_STRIDE, PX, PY, PROT, PSX, PSY } from './skeleton.js';

const TAU = Math.PI * 2;

/**
 * @typedef {Object} OverlayDef
 * @property {string} id
 * @property {string[]} bones — bone names this overlay affects
 * @property {Function} apply — (pose, skeleton, time, dt, params) => void
 */

// ── Built-in overlay factories ──

/**
 * Breathing overlay: rhythmic body/chest scale oscillation.
 */
export function breathingOverlay(config = {}) {
  const amp = config.amp || 0.03;
  const freq = config.freq || 1.2;
  const bones = config.bones || ['body', 'chest'];

  return {
    id: 'breathing',
    bones,
    apply(pose, skeleton, time, dt, params) {
      const weight = params.weight !== undefined ? params.weight : 1;
      const phase = params.phase || 0;
      const scale = 1 + Math.sin(time * freq * TAU + phase) * amp * weight;

      for (const boneName of bones) {
        const idx = skeleton.getBoneIndex(boneName);
        if (idx === -1) continue;
        const off = idx * POSE_STRIDE;
        pose[off + PSX] *= scale;
        pose[off + PSY] *= scale;
      }
    },
  };
}

/**
 * Hover bob overlay: vertical oscillation for floating creatures.
 */
export function hoverBobOverlay(config = {}) {
  const amp = config.amp || 2;
  const freq = config.freq || 0.8;
  const bone = config.bone || 'root';

  return {
    id: 'hover_bob',
    bones: [bone],
    apply(pose, skeleton, time, dt, params) {
      const weight = params.weight !== undefined ? params.weight : 1;
      const phase = params.phase || 0;
      const idx = skeleton.getBoneIndex(bone);
      if (idx === -1) return;
      const off = idx * POSE_STRIDE;
      pose[off + PY] += Math.sin(time * freq * TAU + phase) * amp * weight;
    },
  };
}

/**
 * Recoil overlay: brief backward jolt on damage.
 */
export function recoilOverlay(config = {}) {
  const magnitude = config.magnitude || 3;
  const bone = config.bone || 'body';

  return {
    id: 'recoil',
    bones: [bone],
    apply(pose, skeleton, time, dt, params) {
      // params.intensity decays from 1→0 over reaction duration
      const intensity = params.intensity || 0;
      if (intensity <= 0) return;

      const idx = skeleton.getBoneIndex(bone);
      if (idx === -1) return;
      const off = idx * POSE_STRIDE;

      // Jolt backward (negative Y in local space = "away")
      pose[off + PY] += magnitude * intensity;
      // Slight scale pop
      pose[off + PSX] *= 1 + 0.05 * intensity;
      pose[off + PSY] *= 1 - 0.03 * intensity;
    },
  };
}

/**
 * Tension overlay: forward lean during aggression/chase.
 */
export function tensionOverlay(config = {}) {
  const leanAmount = config.lean || 0.08;
  const bone = config.bone || 'chest';

  return {
    id: 'tension',
    bones: [bone],
    apply(pose, skeleton, time, dt, params) {
      const intensity = params.intensity || 0;
      if (intensity <= 0) return;

      const idx = skeleton.getBoneIndex(bone);
      if (idx === -1) return;
      const off = idx * POSE_STRIDE;

      pose[off + PROT] -= leanAmount * intensity;
    },
  };
}

/**
 * Head look overlay: subtle head rotation toward target.
 */
export function headLookOverlay(config = {}) {
  const maxAngle = config.maxAngle || 0.3;
  const bone = config.bone || 'head';

  return {
    id: 'head_look',
    bones: [bone],
    apply(pose, skeleton, time, dt, params) {
      // params.angle = desired look angle relative to facing
      const angle = params.angle || 0;
      const weight = params.weight !== undefined ? params.weight : 1;

      const idx = skeleton.getBoneIndex(bone);
      if (idx === -1) return;
      const off = idx * POSE_STRIDE;

      const clamped = Math.max(-maxAngle, Math.min(maxAngle, angle));
      pose[off + PROT] += clamped * weight;
    },
  };
}

/**
 * Weapon follow-through overlay: weapon bone continues motion after attack.
 */
export function weaponFollowOverlay(config = {}) {
  const bone = config.bone || 'weapon_anchor';

  return {
    id: 'weapon_follow',
    bones: [bone],
    apply(pose, skeleton, time, dt, params) {
      const progress = params.progress || 0; // 0-1 through the follow-through
      if (progress <= 0) return;

      const idx = skeleton.getBoneIndex(bone);
      if (idx === -1) return;
      const off = idx * POSE_STRIDE;

      // Arc motion
      const swing = Math.sin(progress * Math.PI) * 0.5;
      pose[off + PROT] += swing;
      pose[off + PX] += Math.cos(progress * Math.PI) * 2;
    },
  };
}

// ── Overlay manager ──

/**
 * Create an overlay stack manager.
 * Manages a set of active overlays with their parameters.
 */
export function createOverlayStack() {
  const overlays = [];
  const params = new Map();

  return {
    /**
     * Add an overlay to the stack.
     */
    add(overlay, initialParams = {}) {
      overlays.push(overlay);
      params.set(overlay.id, { weight: 1, ...initialParams });
    },

    /**
     * Set parameters for an overlay.
     */
    setParams(overlayId, newParams) {
      const p = params.get(overlayId);
      if (p) Object.assign(p, newParams);
    },

    /**
     * Get parameters for an overlay.
     */
    getParams(overlayId) {
      return params.get(overlayId) || {};
    },

    /**
     * Apply all overlays to a pose.
     */
    applyAll(pose, skeleton, time, dt) {
      for (const overlay of overlays) {
        const p = params.get(overlay.id) || {};
        overlay.apply(pose, skeleton, time, dt, p);
      }
    },

    /** Clear all overlays */
    clear() {
      overlays.length = 0;
      params.clear();
    },

    /** List active overlay IDs */
    get ids() {
      return overlays.map(o => o.id);
    },
  };
}
