/**
 * Progression visual drawing — renders progression effects for creatures.
 *
 * Draws additive visual layers driven by progression state:
 *   - Body glow (radial, pulsing)
 *   - Energy tendrils (animated wisps radiating from body)
 *   - Halo / crown (overhead ring or crown points)
 *   - Level-up burst (brief radial flash + particles)
 *
 * All drawing uses the same 1-pixel world-unit conventions as draw-pixel.js.
 * Called after the base creature body is drawn, before HP bar.
 *
 * Designed to work at the game's low-res pixel-art scale (270p).
 */

const TAU = Math.PI * 2;

// ── Color helpers (match draw-pixel.js conventions) ──

function rgb(color, alpha) {
  const r = color[0] * 255 | 0;
  const g = color[1] * 255 | 0;
  const b = color[2] * 255 | 0;
  if (alpha !== undefined && alpha < 1) {
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return `rgb(${r},${g},${b})`;
}

function shiftHue(color, shift) {
  // Simplified warm/cool shift: positive = warmer, negative = cooler
  return [
    Math.max(0, Math.min(1, color[0] + shift * 2)),
    Math.max(0, Math.min(1, color[1] + shift * 0.5)),
    Math.max(0, Math.min(1, color[2] - shift * 1.5)),
  ];
}

// ── Body Glow ──

/**
 * Draw a soft radial glow behind/around the creature body.
 */
export function drawProgressionGlow(ctx, cx, cy, progression, palette) {
  if (progression.glowStrength <= 0.01) return;

  const radius = Math.max(1, Math.round(progression.glowRadius));
  const alpha = progression.glowStrength;
  const color = shiftHue(palette.glow || palette.highlight, progression.hueShift);

  // Second-order modulation: glow breathes at a secondary frequency
  const breathe = progression.secondOrderAmp > 0
    ? 1 + Math.sin(progression.modPhase * 2.7) * 0.1 * progression.secondOrderAmp
    : 1;

  const effectiveAlpha = alpha * breathe;
  const effectiveRadius = radius * breathe;

  // Draw concentric rings from outside in, fading outward
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let r = Math.round(effectiveRadius); r >= 1; r--) {
    const t = r / effectiveRadius;
    const ringAlpha = effectiveAlpha * (1 - t * t) * 0.5;
    if (ringAlpha < 0.01) continue;
    ctx.fillStyle = rgb(color, ringAlpha);
    // Draw ring as pixel circle outline
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 <= r * r && d2 > (r - 1) * (r - 1)) {
          ctx.fillRect(Math.round(cx + dx), Math.round(cy + dy), 1, 1);
        }
      }
    }
  }
  // Core bright dot
  if (effectiveAlpha > 0.1) {
    ctx.fillStyle = rgb(color, effectiveAlpha * 0.3);
    ctx.fillRect(Math.round(cx), Math.round(cy), 1, 1);
  }
  ctx.restore();
}

// ── Energy Tendrils ──

/**
 * Draw animated energy tendrils radiating from the creature body.
 */
export function drawProgressionTendrils(ctx, cx, cy, progression, palette, time) {
  if (progression.tendrilCount <= 0 || progression.tendrilAlpha <= 0.01) return;

  const count = progression.tendrilCount;
  const maxLen = progression.tendrilLength;
  const alpha = progression.tendrilAlpha;
  const waveFreq = progression.tendrilWaveFreq;
  const waveAmp = progression.tendrilWaveAmp;
  const motionPhase = progression.tendrilPhase;
  const color = shiftHue(palette.highlight, progression.hueShift);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (let i = 0; i < count; i++) {
    // Distribute tendrils evenly around the body, with motion offset
    const baseAngle = (i / count) * TAU + motionPhase;

    // Second-order wobble on tendril angle — wider sweep
    const wobble = progression.secondOrderAmp > 0
      ? Math.sin(time * 1.8 + i * 2.3) * 0.5 * progression.secondOrderAmp
      : 0;
    // Slow drift so tendrils "breathe" around the body
    const drift = Math.sin(time * 0.4 + i * 1.9) * 0.25;
    const angle = baseAngle + wobble + drift;

    // Tendril length varies per-tendril and with time — more dramatic pulsing
    const lenVar = 0.5 + 0.5 * Math.sin(time * waveFreq * TAU + i * 1.7);
    const len = maxLen * lenVar;

    // Draw tendril as a chain of fading pixels
    const steps = Math.max(3, Math.round(len * 1.5));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const dist = 2 + t * len;  // start 2px from center

      // Primary wave + secondary harmonic for richer motion
      const wave1 = Math.sin(t * waveFreq * TAU + time * 3 + i * 1.1) * waveAmp * t;
      const wave2 = Math.sin(t * waveFreq * TAU * 2.3 + time * 5 + i * 0.7) * waveAmp * 0.4 * t;
      const wave = wave1 + wave2;
      const perpAngle = angle + Math.PI / 2;

      const px = cx + Math.cos(angle) * dist + Math.cos(perpAngle) * wave;
      const py = cy + Math.sin(angle) * dist + Math.sin(perpAngle) * wave;

      // Fade along tendril length — slower falloff for longer visible reach
      const fadeAlpha = alpha * (1 - t * t * 0.7);

      // Ascended shimmer: tendrils sparkle
      const shimmer = progression.ascendedShimmer > 0
        ? 1 + Math.sin(time * 7 + s * 2 + i * 3) * 0.4 * progression.ascendedShimmer
        : 1;

      if (fadeAlpha * shimmer > 0.02) {
        ctx.fillStyle = rgb(color, fadeAlpha * shimmer);
        ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
        // Thicker near root — draw neighbor pixel for first third
        if (t < 0.35 && fadeAlpha * shimmer > 0.05) {
          ctx.fillRect(Math.round(px + Math.cos(perpAngle)), Math.round(py + Math.sin(perpAngle)), 1, 1);
        }
      }
    }
  }

  ctx.restore();
}

// ── Halo / Crown ──

/**
 * Draw halo ring or crown above the creature's head.
 */
export function drawProgressionHalo(ctx, cx, cy, progression, palette, radius) {
  if (progression.haloStage <= 0 || progression.haloAlpha <= 0.01) return;

  const stage = progression.haloStage;
  const alpha = progression.haloAlpha;
  const haloR = Math.max(2, Math.round(progression.haloRadius));
  const rot = progression.haloRotation;
  const color = shiftHue(palette.highlight, progression.hueShift);

  // Halo sits above the creature (close to head, not floating away)
  const haloY = cy - radius - 1;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Stage 1+: Main ring
  drawHaloRing(ctx, cx, haloY, haloR, color, alpha * 0.7, rot);

  // Stage 2+: Second inner ring
  if (stage >= 2) {
    const innerR = Math.max(1, haloR - 2);
    drawHaloRing(ctx, cx, haloY, innerR, color, alpha * 0.4, -rot * 1.3);
  }

  // Stage 3: Crown points
  if (stage >= 3) {
    drawCrownPoints(ctx, cx, haloY, haloR, progression, color, alpha);
  }

  ctx.restore();
}

function drawHaloRing(ctx, cx, cy, r, color, alpha, rotation) {
  if (alpha < 0.02) return;
  // Elliptical ring to suggest 3D tilt — wider than tall
  const rx = r;
  const ry = Math.max(1, Math.round(r * 0.35));

  ctx.fillStyle = rgb(color, alpha);
  for (let a = 0; a < TAU; a += 0.15) {
    const angle = a + rotation;
    const px = cx + Math.cos(angle) * rx;
    const py = cy + Math.sin(angle) * ry;
    ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
  }
}

function drawCrownPoints(ctx, cx, cy, haloR, progression, color, alpha) {
  const count = progression.crownPoints;
  const height = progression.crownPointHeight;

  for (let i = 0; i < count; i++) {
    // Distribute points across the front arc of the halo
    const t = (i + 0.5) / count;
    const angle = Math.PI + t * Math.PI; // front-facing arc
    const baseX = cx + Math.cos(angle + progression.haloRotation) * haloR;
    const baseY = cy + Math.sin(angle + progression.haloRotation) * Math.round(haloR * 0.35);

    // Point rises above base
    for (let dy = 0; dy < height; dy++) {
      const t2 = dy / height;
      const pointAlpha = alpha * (1 - t2 * 0.5);
      if (pointAlpha > 0.02) {
        ctx.fillStyle = rgb(color, pointAlpha);
        ctx.fillRect(Math.round(baseX), Math.round(baseY - dy - 1), 1, 1);
      }
    }
    // Bright tip
    ctx.fillStyle = rgb([1, 1, 1], alpha * 0.6);
    ctx.fillRect(Math.round(baseX), Math.round(baseY - height - 1), 1, 1);
  }
}

// ── Level-up Burst ──

/**
 * Draw a level-up burst effect.
 * @param {object} burstState - from createBurstState()
 */
export function drawLevelUpBurst(ctx, cx, cy, progression, palette, burstState) {
  if (!burstState || !burstState.active) return;

  const progress = burstState.progress;
  const color = shiftHue(palette.highlight, progression.hueShift);

  // Burst fades in quickly then fades out
  const alphaEnvelope = progress < 0.2
    ? progress / 0.2
    : 1 - (progress - 0.2) / 0.8;
  const alpha = progression.burstMaxAlpha * alphaEnvelope;

  // Expanding ring
  const ringRadius = Math.round(progression.burstMaxRadius * progress);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Central flash
  if (progress < 0.3) {
    const flashR = Math.round(4 * (1 - progress / 0.3));
    ctx.fillStyle = rgb([1, 1, 1], alpha * 0.6);
    for (let dy = -flashR; dy <= flashR; dy++) {
      for (let dx = -flashR; dx <= flashR; dx++) {
        if (dx * dx + dy * dy <= flashR * flashR) {
          ctx.fillRect(Math.round(cx + dx), Math.round(cy + dy), 1, 1);
        }
      }
    }
  }

  // Expanding ring
  if (ringRadius > 1) {
    ctx.fillStyle = rgb(color, alpha * 0.5);
    const innerR = Math.max(0, ringRadius - 1);
    for (let dy = -ringRadius; dy <= ringRadius; dy++) {
      for (let dx = -ringRadius; dx <= ringRadius; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 <= ringRadius * ringRadius && d2 > innerR * innerR) {
          ctx.fillRect(Math.round(cx + dx), Math.round(cy + dy), 1, 1);
        }
      }
    }
  }

  // Particles flying outward
  const particleCount = progression.burstParticleCount;
  for (let i = 0; i < particleCount; i++) {
    const angle = (i / particleCount) * TAU + burstState.timer * 3;
    const dist = progression.burstMaxRadius * progress * (0.5 + 0.5 * Math.sin(i * 2.7));
    const px = cx + Math.cos(angle) * dist;
    const py = cy + Math.sin(angle) * dist;
    const pAlpha = alpha * (1 - progress);
    if (pAlpha > 0.02) {
      ctx.fillStyle = rgb(color, pAlpha);
      ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
    }
  }

  ctx.restore();
}

// ── Composite draw function ──

/**
 * Draw all progression visuals for a creature.
 * Call after the base creature body and before HP bar.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx - creature center X (world space)
 * @param {number} cy - creature center Y (world space)
 * @param {object} progression - from deriveProgressionState()
 * @param {object} palette - archetype palette
 * @param {number} radius - creature radius
 * @param {number} time - game time
 * @param {object} [burstState] - from createBurstState()
 * @param {object} [toggles] - { glow, tendrils, halo, burst } override flags
 */
export function drawProgressionEffects(ctx, cx, cy, progression, palette, radius, time, burstState, toggles) {
  if (!progression || progression.intensity <= 0.001) return;

  const show = toggles || {};
  const showGlow = show.glow !== false;
  const showTendrils = show.tendrils !== false;
  const showHalo = show.halo !== false;
  const showBurst = show.burst !== false;

  // Draw order: glow (behind) → tendrils → halo (above) → burst (on top)
  if (showGlow) drawProgressionGlow(ctx, cx, cy, progression, palette);
  if (showTendrils) drawProgressionTendrils(ctx, cx, cy, progression, palette, time);
  if (showHalo) drawProgressionHalo(ctx, cx, cy, progression, palette, radius);
  if (showBurst) drawLevelUpBurst(ctx, cx, cy, progression, palette, burstState);
}
