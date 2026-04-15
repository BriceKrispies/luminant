/**
 * Animation clip and track system.
 *
 * A clip is a named, timed collection of tracks. Each track targets a bone
 * and property (x, y, rotation, scaleX, scaleY, visibility) with keyframes.
 *
 * Sampling a clip at a time produces a partial pose delta that can be applied
 * to a base pose. Clips can loop or play once.
 *
 * Track properties:
 *   'x', 'y'       — additive translation delta
 *   'rotation'     — additive rotation delta
 *   'scaleX', 'scaleY' — multiplicative scale (centered at 1.0)
 *   'visibility'   — 0 or 1 (snaps, no lerp)
 *   'param'        — generic parameter curve (overlay intensity, etc.)
 *
 * Performance: keyframe arrays are small (2-6 frames typical). Linear search
 * is fast enough. No allocations during sampling.
 */

import { POSE_STRIDE, PX, PY, PROT, PSX, PSY } from './skeleton.js';

// Property → pose offset mapping
const PROP_OFFSET = {
  x: PX,
  y: PY,
  rotation: PROT,
  scaleX: PSX,
  scaleY: PSY,
};

// Properties that use multiplicative identity (1.0) instead of additive (0.0)
const SCALE_PROPS = new Set(['scaleX', 'scaleY']);

/**
 * @typedef {Object} Keyframe
 * @property {number} time — normalized [0, 1] within clip duration
 * @property {number} value
 * @property {string} [easing='linear'] — 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'step'
 */

/**
 * @typedef {Object} Track
 * @property {string} bone — bone name
 * @property {string} property — 'x', 'y', 'rotation', 'scaleX', 'scaleY', 'visibility', 'param'
 * @property {Keyframe[]} keyframes — sorted by time
 */

/**
 * @typedef {Object} Clip
 * @property {string} name
 * @property {number} duration — seconds
 * @property {boolean} loop
 * @property {Track[]} tracks
 * @property {Object} [events] — { time: eventName } for triggers (future use)
 */

/**
 * Create a clip definition.
 */
export function createClip(name, duration, loop, tracks, events) {
  return { name, duration, loop, tracks: tracks || [], events: events || {} };
}

/**
 * Create a track with keyframes.
 */
export function createTrack(bone, property, keyframes) {
  // Sort keyframes by time
  const sorted = keyframes.slice().sort((a, b) => a.time - b.time);
  return { bone, property, keyframes: sorted };
}

/**
 * Shorthand for a keyframe.
 */
export function kf(time, value, easing) {
  return { time, value, easing: easing || 'linear' };
}

// ── Easing functions ──

function easeIn(t) { return t * t; }
function easeOut(t) { return t * (2 - t); }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

function applyEasing(t, easing) {
  switch (easing) {
    case 'ease-in': return easeIn(t);
    case 'ease-out': return easeOut(t);
    case 'ease-in-out': return easeInOut(t);
    case 'step': return t < 1 ? 0 : 1;
    default: return t; // linear
  }
}

// ── Sampling ──

/**
 * Sample a single track at a given normalized time.
 * Returns the interpolated value.
 */
export function sampleTrack(track, normalizedTime) {
  const kfs = track.keyframes;
  if (kfs.length === 0) return SCALE_PROPS.has(track.property) ? 1 : 0;
  if (kfs.length === 1) return kfs[0].value;

  // Clamp
  if (normalizedTime <= kfs[0].time) return kfs[0].value;
  if (normalizedTime >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

  // Find surrounding keyframes
  for (let i = 0; i < kfs.length - 1; i++) {
    if (normalizedTime >= kfs[i].time && normalizedTime <= kfs[i + 1].time) {
      const span = kfs[i + 1].time - kfs[i].time;
      if (span < 0.0001) return kfs[i + 1].value;

      const localT = (normalizedTime - kfs[i].time) / span;
      const easedT = applyEasing(localT, kfs[i + 1].easing || 'linear');

      if (track.property === 'visibility') {
        return easedT >= 0.5 ? kfs[i + 1].value : kfs[i].value;
      }

      return kfs[i].value + (kfs[i + 1].value - kfs[i].value) * easedT;
    }
  }

  return kfs[kfs.length - 1].value;
}

/**
 * Sample a full clip into a pose delta array.
 *
 * The pose delta uses:
 *   - 0.0 for additive properties (x, y, rotation) — identity = no change
 *   - 1.0 for scale properties — identity = no change
 *
 * @param {Clip} clip
 * @param {number} time — playback time in seconds
 * @param {Object} skeleton — skeleton to resolve bone names
 * @param {Float64Array} outPose — pose delta to write into
 * @param {Object} [outParams] — optional object to receive param/visibility values
 * @returns {Object|null} outParams if any param/visibility tracks were sampled
 */
export function sampleClip(clip, time, skeleton, outPose, outParams) {
  // Compute normalized time
  let normTime;
  if (clip.loop) {
    normTime = clip.duration > 0 ? (time % clip.duration) / clip.duration : 0;
    if (normTime < 0) normTime += 1;
  } else {
    normTime = clip.duration > 0 ? Math.min(time / clip.duration, 1) : 0;
  }

  // Initialize output to identity
  for (let i = 0; i < outPose.length; i += POSE_STRIDE) {
    outPose[i + PX] = 0;
    outPose[i + PY] = 0;
    outPose[i + PROT] = 0;
    outPose[i + PSX] = 1;
    outPose[i + PSY] = 1;
  }

  let params = outParams || null;

  for (const track of clip.tracks) {
    const value = sampleTrack(track, normTime);

    // Handle non-pose properties
    if (track.property === 'visibility' || track.property === 'param') {
      if (!params) params = {};
      const key = `${track.bone}.${track.property}`;
      params[key] = value;
      continue;
    }

    const boneIdx = skeleton.getBoneIndex(track.bone);
    if (boneIdx === -1) continue;

    const poseOff = PROP_OFFSET[track.property];
    if (poseOff === undefined) continue;

    outPose[boneIdx * POSE_STRIDE + poseOff] = value;
  }

  return params;
}

/**
 * Get the progress ratio of a clip playback (0-1).
 * For looping clips, returns the current loop progress.
 */
export function getClipProgress(clip, time) {
  if (clip.duration <= 0) return 1;
  if (clip.loop) {
    const t = (time % clip.duration) / clip.duration;
    return t < 0 ? t + 1 : t;
  }
  return Math.min(time / clip.duration, 1);
}

/**
 * Check if a non-looping clip has finished.
 */
export function isClipFinished(clip, time) {
  return !clip.loop && time >= clip.duration;
}
