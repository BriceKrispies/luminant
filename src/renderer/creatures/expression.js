/**
 * Face / expression subsystem.
 *
 * Manages facial expression state for creatures. Expressions control
 * eye style, brow angle, pupil position, mouth shape, and any face-zone
 * attachment swaps.
 *
 * Supported expressions:
 *   'neutral'   — default resting face
 *   'angry'     — furrowed brows, narrowed eyes
 *   'surprised' — wide eyes, raised brows
 *   'hurt'      — squinted eyes, grimace
 *   'dead'      — X eyes or closed
 *   'focused'   — slight squint, intent gaze
 *
 * Features:
 *   - Smooth blending between expressions
 *   - Automatic blink timer
 *   - Pupil bias (look direction offset)
 *   - Per-archetype expression configs
 *   - Expression → attachment override mapping
 */

/**
 * @typedef {Object} ExpressionConfig
 * @property {Object} eyeParams — per-expression eye modifications
 * @property {Object} browParams — per-expression brow modifications
 * @property {Object} [attachmentOverrides] — { slotName: AttachmentDef[] }
 * @property {number} [blendSpeed=5] — how fast to blend (per second)
 */

/**
 * @typedef {Object} ExpressionProfile
 * @property {Object.<string, ExpressionConfig>} expressions
 * @property {Object} blinkConfig — { interval: [min, max], duration }
 * @property {boolean} [hasMouth=false]
 */

/**
 * Create an expression controller.
 *
 * @param {ExpressionProfile} profile
 * @param {number} seed — entity ID for blink phase variation
 */
export function createExpressionController(profile, seed) {
  let currentExpression = 'neutral';
  let targetExpression = 'neutral';
  let blendT = 1; // 1 = fully at target
  let blendSpeed = 5;

  // Blink state
  let blinkTimer = (seed * 0.37) % 3; // seeded offset so not all blink together
  let blinkPhase = 0; // 0 = open, >0 = in blink
  const blinkInterval = profile.blinkConfig
    ? profile.blinkConfig.interval
    : [2.5, 5];
  const blinkDuration = profile.blinkConfig
    ? profile.blinkConfig.duration
    : 0.12;
  let nextBlinkAt = blinkInterval[0] + (seed * 0.73 % 1) * (blinkInterval[1] - blinkInterval[0]);

  // Pupil bias
  let pupilBiasX = 0;
  let pupilBiasY = 0;

  return {
    get expression() { return currentExpression; },
    get target() { return targetExpression; },
    get isBlinking() { return blinkPhase > 0; },
    get blinkAmount() {
      if (blinkPhase <= 0) return 0;
      // Triangle wave: 0→1→0 over blinkDuration
      const half = blinkDuration / 2;
      return blinkPhase < half ? blinkPhase / half : (blinkDuration - blinkPhase) / half;
    },
    get pupilX() { return pupilBiasX; },
    get pupilY() { return pupilBiasY; },

    /**
     * Set the target expression. Blends smoothly from current.
     */
    setExpression(name) {
      if (name === targetExpression) return;
      if (!profile.expressions[name]) return;
      currentExpression = targetExpression;
      targetExpression = name;
      blendT = 0;
      blendSpeed = profile.expressions[name].blendSpeed || 5;
    },

    /**
     * Set pupil look direction bias.
     * @param {number} x — -1 to 1, left to right
     * @param {number} y — -1 to 1, up to down
     */
    setPupilBias(x, y) {
      pupilBiasX = x;
      pupilBiasY = y;
    },

    /**
     * Update expression state.
     * @param {number} dt — frame delta time
     */
    update(dt) {
      // Blend toward target expression
      if (blendT < 1) {
        blendT = Math.min(1, blendT + dt * blendSpeed);
      }
      if (blendT >= 1 && currentExpression !== targetExpression) {
        currentExpression = targetExpression;
      }

      // Blink timer (not during death/hurt)
      if (targetExpression !== 'dead' && targetExpression !== 'hurt') {
        blinkTimer += dt;
        if (blinkPhase > 0) {
          blinkPhase += dt;
          if (blinkPhase >= blinkDuration) {
            blinkPhase = 0;
          }
        } else if (blinkTimer >= nextBlinkAt) {
          blinkPhase = 0.001; // start blink
          blinkTimer = 0;
          nextBlinkAt = blinkInterval[0] + Math.random() * (blinkInterval[1] - blinkInterval[0]);
        }
      } else {
        blinkPhase = 0;
      }
    },

    /**
     * Get the current expression parameters, blended between current and target.
     * Returns combined eye/brow params and any attachment overrides.
     */
    getParams() {
      const fromConfig = profile.expressions[currentExpression] || {};
      const toConfig = profile.expressions[targetExpression] || {};
      const t = blendT;

      // Blend eye params
      const eyeParams = blendObjects(fromConfig.eyeParams || {}, toConfig.eyeParams || {}, t);

      // Blend brow params
      const browParams = blendObjects(fromConfig.browParams || {}, toConfig.browParams || {}, t);

      // Attachment overrides come from target (no blend — snap)
      const attachmentOverrides = t > 0.5
        ? (toConfig.attachmentOverrides || null)
        : (fromConfig.attachmentOverrides || null);

      return {
        expression: t >= 1 ? targetExpression : currentExpression,
        eyeParams,
        browParams,
        attachmentOverrides,
        blinkAmount: this.blinkAmount,
        pupilBiasX,
        pupilBiasY,
        blendT: t,
      };
    },

    /**
     * Reset to neutral.
     */
    reset() {
      currentExpression = 'neutral';
      targetExpression = 'neutral';
      blendT = 1;
      blinkPhase = 0;
      blinkTimer = (seed * 0.37) % 3;
      pupilBiasX = 0;
      pupilBiasY = 0;
    },
  };
}

// ── Expression auto-detection from entity state ──

/**
 * Determine the appropriate expression from game state.
 *
 * @param {Object} entity — snapshot entity
 * @param {number} hitTimer — remaining hit reaction time
 * @param {string} animState — current animation controller state
 * @returns {string} expression name
 */
export function detectExpression(entity, hitTimer, animState) {
  if (entity.state === 2) return 'dead';
  if (hitTimer > 0) return 'hurt';
  if (animState === 'attack') return 'angry';
  if (animState === 'locomotion') return 'focused';
  return 'neutral';
}

// ── Helpers ──

function blendObjects(a, b, t) {
  const result = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const va = a[key] !== undefined ? a[key] : 0;
    const vb = b[key] !== undefined ? b[key] : 0;
    if (typeof va === 'number' && typeof vb === 'number') {
      result[key] = va * (1 - t) + vb * t;
    } else {
      result[key] = t > 0.5 ? vb : va;
    }
  }
  return result;
}
