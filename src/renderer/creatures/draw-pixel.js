/**
 * Pixel art creature drawing.
 *
 * Draws creatures directly in world space — each "pixel" is a 1x1
 * world-unit rectangle. No offscreen canvas needed since the render
 * canvas is already low-res (480x270).
 *
 * All positions are offsets from the creature's center (model.x, model.y).
 * Uses the same resolved render model from the rig pipeline.
 */

import { POSE_STRIDE, PX, PY } from './skeleton.js';
import { drawProgressionEffects } from './progression-visuals.js';

// ── Color helpers ──

function rgb(color, alpha) {
  const r = color[0] * 255 | 0;
  const g = color[1] * 255 | 0;
  const b = color[2] * 255 | 0;
  if (alpha !== undefined && alpha < 1) {
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return `rgb(${r},${g},${b})`;
}

function lerpColor(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/** Draw a 1x1 world-unit pixel at (x, y) */
function px(ctx, x, y, color, alpha) {
  ctx.fillStyle = rgb(color, alpha);
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
}

/** Fill a rectangle of pixels */
function pxRect(ctx, x, y, w, h, color, alpha) {
  ctx.fillStyle = rgb(color, alpha);
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

/** Fill a circle of pixels */
function pxCircle(ctx, cx, cy, r, color, alpha) {
  const icx = Math.round(cx);
  const icy = Math.round(cy);
  const ir = Math.round(r);
  ctx.fillStyle = rgb(color, alpha);
  for (let dy = -ir; dy <= ir; dy++) {
    for (let dx = -ir; dx <= ir; dx++) {
      if (dx * dx + dy * dy <= ir * ir) {
        ctx.fillRect(icx + dx, icy + dy, 1, 1);
      }
    }
  }
}

/** Fill an ellipse of pixels */
function pxEllipse(ctx, cx, cy, rx, ry, color, alpha) {
  const icx = Math.round(cx);
  const icy = Math.round(cy);
  const irx = Math.max(1, Math.round(rx));
  const iry = Math.max(1, Math.round(ry));
  ctx.fillStyle = rgb(color, alpha);
  for (let dy = -iry; dy <= iry; dy++) {
    for (let dx = -irx; dx <= irx; dx++) {
      const nx = dx / irx;
      const ny = dy / iry;
      if (nx * nx + ny * ny <= 1) {
        ctx.fillRect(icx + dx, icy + dy, 1, 1);
      }
    }
  }
}

// ── Per-archetype pixel body drawing ──
// All positions are offsets from creature center (0, 0).

function drawPixelBlob(ctx, cx, cy, pal, deform, time) {
  const r = 6;

  // Shadow
  pxEllipse(ctx, cx, cy + r + 1, r - 1, 2, [0, 0, 0], 0.3);

  // Body — three-layer shading
  pxCircle(ctx, cx, cy, r, pal.base);
  pxCircle(ctx, cx + 1, cy + 1, r - 2, pal.interior);
  pxCircle(ctx, cx - 1, cy - 1, r - 2, pal.base);
  pxCircle(ctx, cx - 2, cy - 2, r - 4, pal.highlight);

  // Specular
  px(ctx, cx - 2, cy - 3, [1, 1, 1], 0.7);
  px(ctx, cx - 1, cy - 3, [1, 1, 1], 0.5);
}

function drawPixelWisp(ctx, cx, cy, pal, deform, time) {
  const headY = cy - 3;

  // Shadow
  pxEllipse(ctx, cx, cy + 9, 3, 1, [0, 0, 0], 0.15);

  // Trailing wisps
  for (let i = 0; i < 3; i++) {
    const tx = cx - 2 + i * 2;
    const trailLen = 4 + Math.sin(time * 1.5 + i * 0.8) * 1.5;
    for (let dy = 0; dy < trailLen; dy++) {
      const fade = 1 - dy / trailLen;
      const wx = tx + Math.sin(time * 1.8 + dy * 0.5 + i) * (0.5 + dy * 0.1);
      px(ctx, wx, cy + 3 + dy, pal.base, fade * 0.7);
    }
  }

  // Head region
  pxEllipse(ctx, cx, headY, 4, 4, pal.base);
  pxEllipse(ctx, cx, headY + 1, 3, 3, pal.interior);
  pxEllipse(ctx, cx - 1, headY - 1, 2, 2, pal.highlight);

  // Taper body
  for (let dy = 0; dy < 7; dy++) {
    const width = Math.max(1, 4 - dy * 0.5);
    const y = headY + 4 + dy;
    for (let dx = -width; dx <= width; dx++) {
      px(ctx, cx + dx, y, pal.base, 0.8 - dy * 0.05);
    }
  }

  px(ctx, cx - 2, headY - 2, [1, 1, 1], 0.4);
}

function drawPixelFlame(ctx, cx, cy, pal, deform, time) {
  const baseY = cy + 4;

  // Shadow
  pxEllipse(ctx, cx, baseY + 3, 3, 1, [0, 0, 0], 0.25);

  // Flame body
  const flameH = 12;
  for (let dy = 0; dy < flameH; dy++) {
    const t = dy / flameH;
    const width = Math.max(0, (1 - t * t) * 5);
    const y = baseY - dy;
    const flicker = t > 0.5 ? Math.sin(time * 8 + dy * 0.5) * t * 1 : 0;

    let color;
    if (t < 0.3) color = pal.interior;
    else if (t < 0.7) color = pal.base;
    else color = pal.highlight;

    for (let dx = -width; dx <= width; dx++) {
      px(ctx, cx + dx + flicker, y, color, 1 - Math.abs(dx) / (width + 1) * 0.3);
    }
  }

  // Core
  pxEllipse(ctx, cx, baseY - 3, 2, 3, pal.highlight, 0.6);

  // Tip sparks
  for (let i = 0; i < 2; i++) {
    const sx = cx + Math.sin(time * 6 + i * 2.1) * 2;
    const sy = baseY - flameH + Math.sin(time * 5 + i * 1.7) * 1;
    px(ctx, sx, sy, pal.highlight, 0.6);
  }
}

function drawPixelHomunculus(ctx, model) {
  const { worldPose, skeleton, archetype } = model;
  const pal = archetype.palette;

  // Helper to read bone world position
  function bonePos(name) {
    const idx = skeleton.getBoneIndex(name);
    if (idx === -1) return null;
    const off = idx * POSE_STRIDE;
    return { x: worldPose[off + PX], y: worldPose[off + PY] };
  }

  const body = bonePos('body');
  const chest = bonePos('chest');
  const head = bonePos('head');
  const lShoulder = bonePos('left_shoulder');
  const rShoulder = bonePos('right_shoulder');
  const lArm = bonePos('left_arm');
  const rArm = bonePos('right_arm');
  const lHand = bonePos('left_hand');
  const rHand = bonePos('right_hand');

  if (!body) return; // safety

  // Shadow
  pxEllipse(ctx, body.x, body.y + 8, 6, 2, [0, 0, 0], 0.3);

  // -- Arms behind body (draw first) --
  const armColor = lerpColor(pal.base, pal.interior, 0.3);
  const fistColor = lerpColor(pal.base, pal.highlight, 0.35);

  if (lShoulder && lArm) {
    // Upper arm — thick pixel line
    pxLine(ctx, lShoulder.x, lShoulder.y, lArm.x, lArm.y, armColor, 2);
    if (lHand) {
      // Lower arm
      pxLine(ctx, lArm.x, lArm.y, lHand.x, lHand.y, armColor, 2);
      // Fist
      pxCircle(ctx, lHand.x, lHand.y, 2, fistColor);
    }
  }
  if (rShoulder && rArm) {
    pxLine(ctx, rShoulder.x, rShoulder.y, rArm.x, rArm.y, armColor, 2);
    if (rHand) {
      pxLine(ctx, rArm.x, rArm.y, rHand.x, rHand.y, armColor, 2);
      pxCircle(ctx, rHand.x, rHand.y, 2, fistColor);
    }
  }

  // -- Torso: large hunched mass --
  pxEllipse(ctx, body.x, body.y, 7, 5, pal.base);
  pxEllipse(ctx, body.x, body.y + 1, 6, 4, pal.interior);
  // Highlight on upper-left
  pxEllipse(ctx, body.x - 1, body.y - 1, 4, 3, pal.base);
  pxEllipse(ctx, body.x - 2, body.y - 2, 2, 2, pal.highlight);

  // -- Chest / shoulder hump --
  if (chest) {
    pxEllipse(ctx, chest.x, chest.y, 5, 3, pal.base);
    pxEllipse(ctx, chest.x, chest.y, 4, 2, lerpColor(pal.base, pal.highlight, 0.2));
  }

  // -- Shoulder pads --
  if (lShoulder) {
    pxCircle(ctx, lShoulder.x, lShoulder.y, 2, pal.base);
    px(ctx, lShoulder.x, lShoulder.y - 1, pal.highlight, 0.5);
  }
  if (rShoulder) {
    pxCircle(ctx, rShoulder.x, rShoulder.y, 2, pal.base);
    px(ctx, rShoulder.x, rShoulder.y - 1, pal.highlight, 0.5);
  }

  // -- Head: tiny, hunched forward --
  if (head) {
    pxCircle(ctx, head.x, head.y, 2, pal.base);
    px(ctx, head.x - 1, head.y - 1, pal.highlight, 0.6);
    // Brow ridge
    px(ctx, head.x - 2, head.y - 1, pal.interior);
    px(ctx, head.x + 2, head.y - 1, pal.interior);
  }

  // Specular on body
  px(ctx, body.x - 3, body.y - 3, [1, 1, 1], 0.3);
}

/** Draw a thick pixel line between two points */
function pxLine(ctx, x0, y0, x1, y1, color, thickness) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.round(dist));
  ctx.fillStyle = rgb(color);
  const half = (thickness - 1) / 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = Math.round(x0 + dx * t);
    const py = Math.round(y0 + dy * t);
    ctx.fillRect(px - Math.floor(half), py - Math.floor(half), thickness, thickness);
  }
}

function drawPixelHero(ctx, cx, cy, pal, deform, time) {
  // Shadow
  pxEllipse(ctx, cx, cy + 7, 4, 2, [0, 0, 0], 0.3);

  // Torso
  pxEllipse(ctx, cx, cy + 1, 4, 5, pal.base);
  pxEllipse(ctx, cx + 1, cy + 2, 3, 4, pal.interior);
  pxEllipse(ctx, cx - 1, cy, 3, 4, pal.base);
  pxEllipse(ctx, cx - 1, cy - 1, 2, 3, pal.highlight);

  // Head
  pxCircle(ctx, cx, cy - 4, 3, pal.base);
  pxCircle(ctx, cx - 1, cy - 5, 2, pal.highlight);

  // Arms
  pxEllipse(ctx, cx - 5, cy + 1, 2, 2, pal.base);
  pxEllipse(ctx, cx + 5, cy + 1, 2, 2, pal.base);

  // Specular
  px(ctx, cx - 2, cy - 5, [1, 1, 1], 0.7);
}

// ── Pixel eyes ──

function drawPixelEyes(ctx, model) {
  const { archetype, worldPose, skeleton, expressionParams } = model;
  const pal = archetype.palette;
  const eyes = archetype.eyes;

  // Find face bones
  const eyeBones = [];
  for (let i = 0; i < skeleton.boneCount; i++) {
    if (skeleton.bones[i].tags && skeleton.bones[i].tags.includes('face')) {
      eyeBones.push(i);
    }
  }

  if (eyeBones.length === 0) {
    // Fallback
    const spread = eyes.spread * 3;
    const oy = -eyes.offset * 8;
    drawSingleEye(ctx, model.x - spread, model.y + oy, eyes, pal, expressionParams);
    drawSingleEye(ctx, model.x + spread, model.y + oy, eyes, pal, expressionParams);
    return;
  }

  for (const bi of eyeBones) {
    const off = bi * POSE_STRIDE;
    const bx = worldPose[off + PX];
    const by = worldPose[off + PY];
    drawSingleEye(ctx, bx, by, eyes, pal, expressionParams);
  }
}

function drawSingleEye(ctx, ex, ey, eyes, pal, exprParams) {
  const size = Math.max(1, Math.round(eyes.size * 6));

  let openness = 1;
  let pupilDx = 0;
  let pupilDy = 0;
  if (exprParams) {
    openness = exprParams.eyeOpenness !== undefined ? exprParams.eyeOpenness : 1;
    pupilDx = (exprParams.pupilX || 0) * 1;
    pupilDy = (exprParams.pupilY || 0) * 1;
  }

  if (openness <= 0.1) {
    pxRect(ctx, ex - size, ey, size * 2, 1, pal.eye);
    return;
  }

  switch (eyes.style) {
    case 'dot':
      pxCircle(ctx, ex, ey, size, pal.eye);
      if (size >= 2) px(ctx, ex - 1 + pupilDx, ey - 1 + pupilDy, [1, 1, 1], 0.6);
      break;
    case 'glow':
      if (size > 1) pxCircle(ctx, ex, ey, size, pal.eye, 0.4);
      px(ctx, ex + pupilDx, ey + pupilDy, pal.highlight, 0.9);
      break;
    case 'slit':
      for (let dy = -size; dy <= size; dy++) {
        px(ctx, ex + pupilDx, ey + dy, pal.eye);
      }
      break;
    case 'angry':
      pxRect(ctx, ex - size, ey - size, size * 2 + 1, size * 2 + 1, pal.eye);
      px(ctx, ex - size, ey - size - 1, pal.eye);
      px(ctx, ex + size, ey - size - 1, pal.eye);
      if (size >= 2) px(ctx, ex + pupilDx, ey + pupilDy, [1, 1, 1], 0.5);
      break;
  }
}

// ── HP bar ──

function drawPixelHP(ctx, model) {
  if (model.hp >= model.maxHp || model.deform.isDying) return;
  const frac = model.hp / model.maxHp;
  const barW = Math.round(model.radius * 1.2);
  const barX = model.x - barW / 2;
  const barY = model.y - model.radius - 3;

  pxRect(ctx, barX - 1, barY - 1, barW + 2, 3, [0, 0, 0], 0.6);
  const fillW = Math.max(1, Math.round(barW * frac));
  const hpColor = frac > 0.5 ? [0.2, 0.8, 0.3] : frac > 0.25 ? [0.9, 0.7, 0.1] : [0.9, 0.2, 0.15];
  pxRect(ctx, barX, barY, fillW, 1, hpColor);
}

// ── Main entry point ──

/**
 * Draw a creature as pixel art directly in world space.
 * Each pixel primitive is a 1x1 world-unit rectangle.
 */
export function drawCreaturePixel(ctx, model) {
  const { deform } = model;
  const cx = model.x;
  const cy = model.y;
  const time = Date.now() / 1000;
  const pal = model.archetype.palette;
  const archetypeId = model.archetype.id;

  ctx.save();

  // Opacity
  if (deform.opacity < 1) {
    ctx.globalAlpha = Math.max(0, deform.opacity);
  }

  // Progression glow (behind body)
  const progression = model.progression;
  const pToggles = model.progressionToggles;
  if (progression && progression.glowStrength > 0.01) {
    const glowOnly = { glow: true, tendrils: false, halo: false, burst: false };
    if (pToggles) glowOnly.glow = pToggles.glow !== false;
    drawProgressionEffects(ctx, cx, cy, progression, pal, model.radius, time, null, glowOnly);
  }

  // Draw body
  switch (archetypeId) {
    case 'slime':  drawPixelBlob(ctx, cx, cy, pal, deform, time); break;
    case 'ghost':  drawPixelWisp(ctx, cx, cy, pal, deform, time); break;
    case 'ember':  drawPixelFlame(ctx, cx, cy, pal, deform, time); break;
    case 'brute':  model.useSkeleton ? drawPixelHomunculus(ctx, model) : drawPixelBlob(ctx, cx, cy, pal, deform, time); break;
    case 'player': drawPixelHero(ctx, cx, cy, pal, deform, time); break;
    default:       drawPixelBlob(ctx, cx, cy, pal, deform, time); break;
  }

  // Eyes
  drawPixelEyes(ctx, model);

  // Progression effects (tendrils, halo, burst — above body)
  if (progression) {
    const aboveToggles = { glow: false, tendrils: true, halo: true, burst: true };
    if (pToggles) {
      aboveToggles.tendrils = pToggles.tendrils !== false;
      aboveToggles.halo = pToggles.halo !== false;
      aboveToggles.burst = pToggles.burst !== false;
    }
    drawProgressionEffects(ctx, cx, cy, progression, pal, model.radius, time, model.burstState, aboveToggles);
  }

  // HP bar
  drawPixelHP(ctx, model);

  // Hit flash — draw a white overlay on the creature area
  if (deform.flash > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,255,255,${deform.flash * 0.4})`;
    const r = model.radius;
    pxCircle(ctx, cx, cy, r, [1, 1, 1], deform.flash * 0.4);
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();
}
