/**
 * Composable deformation layers for procedural creatures.
 *
 * Each deformation function takes entity state + time and returns
 * per-vertex or per-body modifications. Deformations compose additively
 * on the creature's base shape.
 *
 * Layers:
 *   1. Wobble — organic perimeter oscillation (idle life)
 *   2. Breathing — slow rhythmic scale pulse
 *   3. Squash & stretch — velocity-driven body distortion
 *   4. Hit reaction — brief flash + scale pop on damage
 *   5. Attack — forward lunge emphasis
 *   6. Death — type-specific dissolve/splat/fade
 */

const TAU = Math.PI * 2;

// ── Animation state detection ──

/**
 * Determine the creature's animation state from entity data.
 *
 * States:
 *   'dying'    — entity state is DYING (state === 2)
 *   'hit'      — recently took damage (hp < previous hp, tracked externally)
 *   'attacking'— near player and moving toward them (heuristic)
 *   'moving'   — has velocity
 *   'idle'     — default
 */
export function detectAnimState(entity, hitTimer) {
  if (entity.state === 2) return 'dying';
  if (hitTimer > 0) return 'hit';

  const speed = Math.sqrt(entity.vx * entity.vx + entity.vy * entity.vy);
  if (speed > 5) return 'moving';
  return 'idle';
}

// ── Deformation layers ──

/**
 * Wobble: organic perimeter oscillation.
 * Returns a radius multiplier for a given angle around the body.
 *
 * @param {number} angle — angle around body perimeter (radians)
 * @param {number} time — game time
 * @param {object} config — { amp, freq, octaves }
 * @param {number} phase — per-entity phase offset
 * @returns {number} radius multiplier (centered at 1.0)
 */
export function wobble(angle, time, config, phase = 0) {
  const { amp, freq, octaves } = config;
  let value = 0;
  let a = amp;
  let f = freq;
  for (let i = 0; i < octaves; i++) {
    value += Math.sin(angle * (3 + i * 2) + time * f + phase) * a;
    a *= 0.5;
    f *= 1.7;
  }
  return 1.0 + value;
}

/**
 * Breathing: slow rhythmic scale pulse.
 * Returns a uniform scale multiplier.
 *
 * @param {number} time — game time
 * @param {object} config — { amp, freq }
 * @param {number} phase — per-entity phase offset
 * @returns {number} scale multiplier (centered at 1.0)
 */
export function breathing(time, config, phase = 0) {
  return 1.0 + Math.sin(time * config.freq * TAU + phase) * config.amp;
}

/**
 * Squash & stretch: velocity-driven body distortion.
 * Returns { scaleX, scaleY, rotation } for the body transform.
 *
 * @param {number} vx — entity velocity X
 * @param {number} vy — entity velocity Y
 * @param {object} config — { moveFactor }
 * @returns {{ scaleX: number, scaleY: number, rotation: number }}
 */
export function squashStretch(vx, vy, config) {
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed < 2) return { scaleX: 1, scaleY: 1, rotation: 0 };

  const factor = Math.min(speed * config.moveFactor * 0.01, 0.3);
  const angle = Math.atan2(vy, vx);

  return {
    scaleX: 1 + factor,       // stretch along movement direction
    scaleY: 1 - factor * 0.5, // compress perpendicular
    rotation: angle,
  };
}

/**
 * Hit reaction: brief flash and scale pop.
 * Returns { flash: 0-1, scalePop: multiplier }.
 *
 * @param {number} hitTimer — time remaining in hit state (counts down from flashDuration)
 * @param {object} config — { flashDuration, scalePulse }
 * @returns {{ flash: number, scalePop: number }}
 */
export function hitReaction(hitTimer, config) {
  if (hitTimer <= 0) return { flash: 0, scalePop: 1 };

  const t = hitTimer / config.flashDuration; // 1 at start, 0 at end
  return {
    flash: t,
    scalePop: 1 + config.scalePulse * t,
  };
}

/**
 * Death animation: type-specific dissolve.
 * Returns { progress: 0-1, type, opacity, scale, scatter }.
 *
 * @param {number} deathTimer — time into death animation
 * @param {object} config — { type, duration }
 * @returns {{ progress: number, type: string, opacity: number, scale: number, scatter: number }}
 */
export function deathAnim(deathTimer, config) {
  const t = Math.min(deathTimer / config.duration, 1); // 0 → 1

  switch (config.type) {
    case 'splat':
      // Slime: flatten out rapidly, then fade
      return {
        progress: t,
        type: 'splat',
        opacity: 1 - t * t,
        scale: 1 + t * 0.8,     // expand horizontally
        scaleY: 1 - t * 0.6,    // flatten vertically
        scatter: 0,
      };

    case 'fade':
      // Ghost: ethereal fade-out, float upward
      return {
        progress: t,
        type: 'fade',
        opacity: 1 - t,
        scale: 1 + t * 0.2,
        scaleY: 1 + t * 0.3,    // elongate upward
        scatter: 0,
        yOffset: -t * 15,       // float up
      };

    case 'puff':
      // Ember: rapid expansion then vanish
      return {
        progress: t,
        type: 'puff',
        opacity: (1 - t) * (1 - t),
        scale: 1 + t * 1.5,
        scaleY: 1 + t * 1.5,
        scatter: t * 8,         // particle scatter radius
      };

    case 'crumble':
      // Brute: chunk apart and fall
      return {
        progress: t,
        type: 'crumble',
        opacity: 1 - t * 0.8,
        scale: 1 - t * 0.3,
        scaleY: 1 - t * 0.4,
        scatter: t * 12,
        yOffset: t * t * 10,   // drop
      };

    default:
      return {
        progress: t, type: 'splat',
        opacity: 1 - t, scale: 1, scaleY: 1, scatter: 0,
      };
  }
}

/**
 * Compose all active deformations for a creature into a single transform descriptor.
 *
 * @param {object} entity — snapshot entity { x, y, vx, vy, hp, maxHp, radius, state, type, id }
 * @param {number} time — game time
 * @param {object} archetype — archetype definition from archetypes.js
 * @param {object} variation — per-entity variation from buildVariation()
 * @param {object} animState — { state, hitTimer, deathTimer }
 * @returns {object} composed deformation descriptor
 */
export function composeDeformations(entity, time, archetype, variation, animState) {
  const d = archetype.deform;
  const phase = variation.wobblePhase || 0;

  // Base breathing scale
  const breathScale = breathing(time, d.breathing, phase * 0.5);

  // Squash-stretch from velocity
  const ss = squashStretch(entity.vx, entity.vy, d.squashStretch);

  // Hit reaction
  const hit = hitReaction(animState.hitTimer, d.hit);

  // Death
  const isDying = animState.state === 'dying';
  const death = isDying ? deathAnim(animState.deathTimer, d.death) : null;

  // Combine scales
  const baseScale = (variation.scaleJitter || 1) * breathScale * hit.scalePop;

  return {
    // Per-angle wobble function (called by draw layer per vertex)
    wobbleAt: (angle) => wobble(angle, time, d.wobble, phase),

    // Body transform
    scaleX: baseScale * ss.scaleX * (death ? death.scale : 1),
    scaleY: baseScale * ss.scaleY * (death ? (death.scaleY || death.scale) : 1),
    rotation: ss.rotation,

    // Visual modifiers
    opacity: (variation.opacity || 1) * (death ? death.opacity : 1),
    flash: hit.flash,
    hueShift: variation.hueShift || 0,

    // Death-specific
    death,
    isDying,

    // Positional offset
    yOffset: death ? (death.yOffset || 0) : 0,
  };
}
