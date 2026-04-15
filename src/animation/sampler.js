/**
 * Clip sampler — evaluates animation clips at a given time.
 *
 * Writes sampled values into a pose array. Handles looping, clamping,
 * and correct rotation interpolation across angle wrap.
 */

import { STRIDE, TX, TY, ROT, SX, SY } from './pose.js';

/**
 * Normalize angle to [-PI, PI].
 */
function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Interpolate rotation correctly across wraparound.
 * Takes shortest path between angles.
 */
function lerpAngle(a, b, t) {
  let diff = normalizeAngle(b - a);
  return a + diff * t;
}

/**
 * Linear interpolation.
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Sample a single keyframe channel at a given time.
 * @param {Array} keyframes — sorted by time, each { time, value }
 * @param {number} time
 * @param {boolean} isRotation — use angle lerp
 * @returns {number|null} — sampled value or null if no keyframes
 */
export function sampleChannel(keyframes, time, isRotation = false) {
  if (!keyframes || keyframes.length === 0) return null;
  if (keyframes.length === 1) return keyframes[0].value;

  // Clamp to range
  if (time <= keyframes[0].time) return keyframes[0].value;
  if (time >= keyframes[keyframes.length - 1].time) return keyframes[keyframes.length - 1].value;

  // Find segment
  for (let i = 0; i < keyframes.length - 1; i++) {
    const k0 = keyframes[i];
    const k1 = keyframes[i + 1];
    if (time >= k0.time && time <= k1.time) {
      const segLen = k1.time - k0.time;
      const t = segLen > 0 ? (time - k0.time) / segLen : 0;
      return isRotation ? lerpAngle(k0.value, k1.value, t) : lerp(k0.value, k1.value, t);
    }
  }

  return keyframes[keyframes.length - 1].value;
}

// Channel key -> pose offset, isRotation flag
const CHANNEL_MAP = {
  tx: { offset: TX, isRot: false },
  ty: { offset: TY, isRot: false },
  rot: { offset: ROT, isRot: true },
  sx: { offset: SX, isRot: false },
  sy: { offset: SY, isRot: false },
};

/**
 * Sample a clip at a given time and write results into outPose.
 *
 * Only writes bones/channels that have tracks. The rest of the pose is untouched.
 * For additive usage: caller provides a zeroed delta pose,
 * then applies it on top of a base via applyDelta.
 *
 * @param {object} clipData — from clip()
 * @param {number} time — in seconds
 * @param {object} skeleton — for bone name lookup
 * @param {Float64Array} outPose — pose to write into
 * @param {boolean} [asDelta] — if true, write as deltas (tx/ty/rot=0 base, scale=1 base)
 */
export function sampleClip(clipData, time, skeleton, outPose, asDelta = false) {
  const dur = clipData.duration;
  let t = time;

  if (clipData.loop && dur > 0) {
    t = ((t % dur) + dur) % dur; // positive modulo
  } else {
    t = Math.max(0, Math.min(t, dur));
  }

  for (const tr of clipData.tracks) {
    const bi = skeleton.getBoneIndex(tr.boneName);
    if (bi === -1) continue;
    const off = bi * STRIDE;

    for (const [chKey, chInfo] of Object.entries(CHANNEL_MAP)) {
      const keyframes = tr[chKey];
      if (!keyframes) continue;
      const val = sampleChannel(keyframes, t, chInfo.isRot);
      if (val !== null) {
        outPose[off + chInfo.offset] = val;
      }
    }
  }
}

/**
 * Get progress through a clip [0,1].
 */
export function getClipProgress(clipData, time) {
  if (clipData.duration <= 0) return 1;
  if (clipData.loop) return (((time % clipData.duration) + clipData.duration) % clipData.duration) / clipData.duration;
  return Math.min(1, time / clipData.duration);
}

/**
 * Check if a non-looping clip is finished.
 */
export function isClipFinished(clipData, time) {
  return !clipData.loop && time >= clipData.duration;
}
