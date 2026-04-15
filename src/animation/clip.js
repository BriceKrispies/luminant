/**
 * Animation clip format.
 *
 * A clip contains tracks keyed to bone names. Each track has channels
 * for translation, rotation, and scale, each with keyframes at timestamps.
 *
 * Clips can loop or play once (clamp).
 */

/**
 * Create a keyframe.
 * @param {number} time — time in seconds
 * @param {number} value
 */
export function kf(time, value) {
  return { time, value };
}

/**
 * Create a track for a single bone.
 * @param {string} boneName
 * @param {object} channels — { tx, ty, rot, sx, sy } arrays of keyframes
 */
export function track(boneName, channels = {}) {
  return {
    boneName,
    tx: channels.tx || null,
    ty: channels.ty || null,
    rot: channels.rot || null,
    sx: channels.sx || null,
    sy: channels.sy || null,
  };
}

/**
 * Create an animation clip.
 * @param {string} name
 * @param {number} duration — seconds
 * @param {Array} tracks — array of track objects
 * @param {object} [opts]
 * @param {boolean} [opts.loop] — whether to loop (default: true)
 */
export function clip(name, duration, tracks, opts = {}) {
  return {
    name,
    duration,
    tracks,
    loop: opts.loop !== undefined ? opts.loop : true,
  };
}
