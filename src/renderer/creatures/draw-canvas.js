/**
 * Canvas 2D procedural creature drawing.
 *
 * Draws creatures using their resolved render models.
 * Supports two paths:
 *   1. Skeleton-based: draws from world-space bone poses + resolved slot attachments
 *   2. Legacy: draws from archetype shapes + deformation data
 *
 * Attachment draw functions handle each attachment type:
 *   shape  — body outlines, limbs, appendages
 *   eye    — dot, glow, slit, angry styles with expression support
 *   feature — interior shading, highlights, hot cores
 *   accent — glows, wisps, flame tips, trails
 *   fx     — particle effects (future)
 *
 * Both Canvas 2D and WebGPU renderers use this module
 * (WebGPU draws creatures on its Canvas 2D overlay).
 */

import { POSE_STRIDE, PX, PY, PROT, PSX, PSY } from './skeleton.js';
import { drawSVGShape } from './svg-renderer.js';
import { PATHS as GHOST_PATHS } from './shapes/ghost.js';

const TAU = Math.PI * 2;

// ── Global lighting ──
// Light comes from upper-left. Values are in normalized [-1,1] space.
const LIGHT_X = -0.45;
const LIGHT_Y = -0.55;
const LIGHT_LEN = Math.sqrt(LIGHT_X * LIGHT_X + LIGHT_Y * LIGHT_Y);
const LIGHT_NX = LIGHT_X / LIGHT_LEN;
const LIGHT_NY = LIGHT_Y / LIGHT_LEN;

/**
 * Create a radial gradient simulating 3D volume lighting on a body shape.
 * Bright highlight offset toward light source, darker on shadow side.
 */
function createLitGradient(ctx, pal, hueShift, extent, alpha) {
  const a = alpha !== undefined ? alpha : 1;
  const grad = ctx.createRadialGradient(
    LIGHT_NX * extent * 0.35, LIGHT_NY * extent * 0.35, extent * 0.05,
    -LIGHT_NX * extent * 0.15, -LIGHT_NY * extent * 0.15, extent * 1.15
  );
  grad.addColorStop(0, colorToCSS(pal.highlight, hueShift, 0.95 * a));
  grad.addColorStop(0.45, colorToCSS(pal.base, hueShift, a));
  grad.addColorStop(1, colorToCSS(pal.interior, hueShift, 0.85 * a));
  return grad;
}

/**
 * Draw a rim/edge highlight on the lit side of the current path.
 * Call immediately after filling a body shape (path must still be active).
 */
function drawRimLight(ctx, pal, hueShift, lineWidth) {
  ctx.save();
  // Clip to the existing shape, then draw a large bright stroke
  // offset toward the light — only the edge inside the clip shows
  ctx.clip();
  ctx.strokeStyle = colorToCSS(pal.highlight, hueShift, 0.35);
  ctx.lineWidth = lineWidth || 0.12;
  ctx.translate(LIGHT_NX * 0.04, LIGHT_NY * 0.04);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a specular highlight — bright spot suggesting curved surface.
 */
function drawSpecular(ctx, pal, hueShift, x, y, r) {
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, colorToCSS(pal.highlight, hueShift, 0.55));
  grad.addColorStop(0.5, colorToCSS(pal.highlight, hueShift, 0.15));
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

/**
 * Draw a drop shadow beneath a creature — dark, elongated ellipse.
 */
function drawDropShadow(ctx, x, y, radius) {
  ctx.save();
  ctx.translate(x, y + radius * 0.7);
  ctx.scale(1, 0.35);
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.9);
  grad.addColorStop(0, 'rgba(0,0,0,0.3)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.12)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.9, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * Draw a depth-aware outline — thicker/darker on shadow side, thinner on lit side.
 * Call with a path already defined.
 */
function drawDepthOutline(ctx, pal, hueShift, baseWidth) {
  const w = baseWidth || 0.06;
  // Shadow side: darker, thicker
  ctx.save();
  ctx.strokeStyle = colorToCSS(pal.interior, hueShift, 0.5);
  ctx.lineWidth = w * 1.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a single creature from its resolved model.
 */
export function drawCreature(ctx, model) {
  if (model.useSkeleton) {
    drawCreatureSkeleton(ctx, model);
  } else {
    drawCreatureLegacy(ctx, model);
  }
}

// ══════════════════════════════════════════════════════════
//  Skeleton-based drawing
// ══════════════════════════════════════════════════════════

function drawCreatureSkeleton(ctx, model) {
  const { archetype, variation, deform, skeleton, worldPose, resolvedSlots, expressionParams, facing, radius } = model;
  const pal = archetype.palette;

  ctx.save();

  // Global opacity
  if (deform.opacity < 1) {
    ctx.globalAlpha = Math.max(0, deform.opacity);
  }

  // Drop shadow for ground contact
  if (!deform.isDying) {
    drawDropShadow(ctx, model.x, model.y, radius * deform.scaleX);
  }

  // Draw resolved slots in draw order
  for (const slot of resolvedSlots) {
    const boneIdx = slot.boneIndex;
    if (boneIdx === -1) continue;

    const off = boneIdx * POSE_STRIDE;
    const bx = worldPose[off + PX];
    const by = worldPose[off + PY];
    const brot = worldPose[off + PROT];
    const bsx = worldPose[off + PSX];
    const bsy = worldPose[off + PSY];

    for (const att of slot.attachments) {
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(brot);
      ctx.scale(bsx, bsy);

      switch (att.type) {
        case 'shape':
          drawShapeAttachment(ctx, att, pal, deform, variation, radius);
          break;
        case 'eye':
          drawEyeAttachment(ctx, att, pal, deform, expressionParams, facing, brot, radius);
          break;
        case 'feature':
          drawFeatureAttachment(ctx, att, pal, deform, radius);
          break;
        case 'accent':
          drawAccentAttachment(ctx, att, pal, deform, variation, radius);
          break;
        case 'fx':
          // Future extension point
          break;
      }

      ctx.restore();
    }
  }

  // Flash overlay on hit
  if (deform.flash > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255, 255, 255, ${deform.flash * 0.6})`;
    ctx.beginPath();
    ctx.arc(model.x, model.y, radius * deform.scaleX * 1.1, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // HP bar
  if (model.hp < model.maxHp && !deform.isDying) {
    drawHPBar(ctx, model.x, model.y - radius * deform.scaleY - 8, radius * 1.5, model.hp, model.maxHp);
  }

  ctx.restore();
}

// ── Shape attachment drawers ──

function drawShapeAttachment(ctx, att, pal, deform, variation, radius) {
  const p = att.params;

  switch (p.shape) {
    case 'blob_body':
      drawBlobBody(ctx, p, pal, deform, radius);
      break;
    case 'wisp_body':
      drawWispBody(ctx, p, pal, deform, variation, radius);
      break;
    case 'flame_body':
      drawFlameBody(ctx, p, pal, deform, variation, radius);
      break;
    case 'hulk_body':
      drawHulkBody(ctx, p, pal, deform, variation, radius);
      break;
    case 'tendril':
      drawTendril(ctx, p, pal, deform);
      break;
    case 'shoulder_pad':
      drawShoulderPad(ctx, p, pal, deform);
      break;
    case 'thick_arm':
      drawThickArm(ctx, p, pal, deform);
      break;
    case 'nub':
      drawNub(ctx, p, pal, deform);
      break;
    default:
      break;
  }
}

function drawBlobBody(ctx, p, pal, deform, radius) {
  const segments = p.segments || 12;
  const r = 1; // normalized — bone scale handles actual size

  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * TAU;
    const wobbleMul = deform.wobbleAt(angle);
    const pr = r * wobbleMul;
    const px = Math.cos(angle) * pr;
    const py = Math.sin(angle) * pr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  // Lit gradient fill for 3D volume
  ctx.fillStyle = createLitGradient(ctx, pal, deform.hueShift, r);
  ctx.fill();

  // Depth outline
  drawDepthOutline(ctx, pal, deform.hueShift, 0.05);

  // Rim light on lit edge
  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * TAU;
    const wobbleMul = deform.wobbleAt(angle);
    const pr = r * wobbleMul;
    const px = Math.cos(angle) * pr;
    const py = Math.sin(angle) * pr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  drawRimLight(ctx, pal, deform.hueShift, 0.15);

  // Specular highlight
  drawSpecular(ctx, pal, deform.hueShift, LIGHT_NX * 0.35, LIGHT_NY * 0.35, r * 0.4);

  // Death: splat ring
  if (deform.death && deform.death.type === 'splat' && deform.death.progress > 0.3) {
    const dp = deform.death.progress;
    ctx.strokeStyle = colorToCSS(pal.base, deform.hueShift, 0.3 * (1 - dp));
    ctx.lineWidth = 2 / (deform.scaleX || 1);
    ctx.beginPath();
    ctx.arc(0, 0, r * (1.2 + dp * 0.5), 0, TAU);
    ctx.stroke();
  }
}

function drawWispBody(ctx, p, pal, deform, variation, radius) {
  // SVG-traced wraith shape — paths from reference art
  ctx.save();

  // Apply opacity
  if (deform.opacity < 1) {
    ctx.globalAlpha *= deform.opacity;
  }

  // Draw SVG paths with luminance-based palette remapping
  drawSVGShape(ctx, GHOST_PATHS, pal, deform.hueShift, deform.opacity);

  ctx.restore();

  // Death: fade upward with dissolving wisps
  if (deform.death && deform.death.type === 'fade') {
    const dp = deform.death.progress;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + dp * 3;
      const d = dp * 0.8;
      const px = Math.cos(a) * d;
      const py = Math.sin(a) * d - dp * 0.5;
      ctx.beginPath();
      ctx.ellipse(px, py, 0.1 * (1 - dp), 0.15 * (1 - dp), a, 0, TAU);
      ctx.fillStyle = colorToCSS(pal.base, deform.hueShift, (1 - dp) * 0.4);
      ctx.fill();
    }
  }
}

function drawFlameBody(ctx, p, pal, deform, variation, radius) {
  const segments = p.segments || 10;
  const flickerPoints = p.flickerPoints || 4;
  const flickerSpeed = variation.flickerSpeed || 1;
  const r = 1;

  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = t * TAU - Math.PI / 2;
    let baseR = r;
    const verticalT = (Math.sin(angle) + 1) / 2;
    baseR *= 0.6 + verticalT * 0.5;

    const flickerAngle = angle * flickerPoints + deform.wobbleAt(angle) * 3;
    const flicker = Math.sin(flickerAngle * flickerSpeed) * r * 0.15;
    const wobbleMul = deform.wobbleAt(angle);
    const finalR = (baseR + flicker) * wobbleMul;

    const px = Math.cos(angle) * finalR;
    const py = Math.sin(angle) * finalR;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  // Lit gradient fill
  ctx.fillStyle = createLitGradient(ctx, pal, deform.hueShift, r);
  ctx.fill();

  // Depth outline
  drawDepthOutline(ctx, pal, deform.hueShift, 0.04);

  // Specular on the hot core
  drawSpecular(ctx, pal, deform.hueShift, LIGHT_NX * 0.2, LIGHT_NY * 0.2 + 0.1, r * 0.35);

  // Death: puff particles
  if (deform.death && deform.death.type === 'puff' && deform.death.scatter > 0) {
    const scatter = deform.death.scatter;
    const dp = deform.death.progress;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + dp * 2;
      const d = scatter * (0.5 + Math.sin(i * 3.7) * 0.5) / (deform.scaleX || 1);
      const px = Math.cos(a) * d;
      const py = Math.sin(a) * d;
      const pr = r * 0.2 * (1 - dp);
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, TAU);
      ctx.fillStyle = colorToCSS(pal.base, deform.hueShift, (1 - dp) * 0.6);
      ctx.fill();
    }
  }
}

function drawHulkBody(ctx, p, pal, deform, variation, radius) {
  const segments = p.segments || 8;
  const spikes = p.spikes || 4;
  const spikeLen = (p.spikeLength || 0.25) * (variation.spikeJitter || 1);
  const r = 1;

  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * TAU;
    const wobbleMul = deform.wobbleAt(angle);

    let spikeBonus = 0;
    for (let s = 0; s < spikes; s++) {
      const spikeAngle = (s / spikes) * TAU;
      const diff = Math.abs(((angle - spikeAngle + Math.PI) % TAU) - Math.PI);
      if (diff < 0.4) {
        spikeBonus = spikeLen * r * (1 - diff / 0.4);
      }
    }

    const pr = (r + spikeBonus) * wobbleMul;
    const px = Math.cos(angle) * pr;
    const py = Math.sin(angle) * pr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  // Lit gradient fill for 3D volume
  ctx.fillStyle = createLitGradient(ctx, pal, deform.hueShift, r);
  ctx.fill();

  // Depth outline — thicker for the brute
  drawDepthOutline(ctx, pal, deform.hueShift, 0.07);

  // Rebuild path for rim light
  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * TAU;
    const wobbleMul = deform.wobbleAt(angle);
    let spikeBonus2 = 0;
    for (let s = 0; s < spikes; s++) {
      const spikeAngle = (s / spikes) * TAU;
      const diff = Math.abs(((angle - spikeAngle + Math.PI) % TAU) - Math.PI);
      if (diff < 0.4) {
        spikeBonus2 = spikeLen * r * (1 - diff / 0.4);
      }
    }
    const pr = (r + spikeBonus2) * wobbleMul;
    const px = Math.cos(angle) * pr;
    const py = Math.sin(angle) * pr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  drawRimLight(ctx, pal, deform.hueShift, 0.18);

  // Specular highlight
  drawSpecular(ctx, pal, deform.hueShift, LIGHT_NX * 0.3, LIGHT_NY * 0.3, r * 0.35);

  // Death: crumble chunks
  if (deform.death && deform.death.type === 'crumble' && deform.death.scatter > 0) {
    const scatter = deform.death.scatter;
    const dp = deform.death.progress;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + i * 1.3;
      const d = scatter * (0.3 + (i % 3) * 0.25) / (deform.scaleX || 1);
      const px = Math.cos(a) * d;
      const py = Math.sin(a) * d;
      const chunkR = r * (0.15 + (i % 2) * 0.1) * (1 - dp * 0.5);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(i * 1.1 + dp * 2);
      ctx.fillStyle = colorToCSS(pal.base, deform.hueShift, (1 - dp) * 0.7);
      ctx.fillRect(-chunkR, -chunkR, chunkR * 2, chunkR * 1.5);
      ctx.restore();
    }
  }
}

function drawTendril(ctx, p, pal, deform) {
  const len = p.length || 0.3;

  // Skeletal twig arm — thin, angular, bony with sharp claw fingers
  // Like a bare tree branch ending in splayed prongs

  // Main arm stroke — thin line with angular bend at "elbow"
  const elbowX = -0.02;
  const elbowY = len * 0.55;
  const wristX = 0.01;
  const wristY = len * 0.92;

  // Arm silhouette — very thin (width ~0.025)
  ctx.beginPath();
  ctx.moveTo(-0.025, 0);
  ctx.lineTo(-0.02, len * 0.2);
  ctx.lineTo(elbowX - 0.018, elbowY);        // elbow, slight outward angle
  ctx.lineTo(wristX - 0.012, wristY);         // forearm, slightly angled inward

  // Splayed claw fingers — 3 long thin prongs
  ctx.lineTo(-0.08, len + 0.16);              // outer claw — long, swept out
  ctx.lineTo(wristX - 0.005, wristY + 0.02);
  ctx.lineTo(0.0, len + 0.2);                 // center claw — longest
  ctx.lineTo(wristX + 0.008, wristY + 0.015);
  ctx.lineTo(0.09, len + 0.13);               // inner claw — swept other way
  ctx.lineTo(wristX + 0.012, wristY);

  // Back edge
  ctx.lineTo(elbowX + 0.018, elbowY);
  ctx.lineTo(0.02, len * 0.2);
  ctx.lineTo(0.025, 0);
  ctx.closePath();

  // Gradient — lighter at shoulder, darker at claws
  const grad = ctx.createLinearGradient(0, 0, 0, len + 0.1);
  grad.addColorStop(0, colorToCSS(pal.highlight, deform.hueShift, 0.65));
  grad.addColorStop(0.5, colorToCSS(pal.base, deform.hueShift, 0.7));
  grad.addColorStop(1, colorToCSS(pal.interior, deform.hueShift, 0.6));
  ctx.fillStyle = grad;
  ctx.fill();

  // Thin dark center line for bone definition
  ctx.strokeStyle = colorToCSS(pal.interior, deform.hueShift, 0.35);
  ctx.lineWidth = 0.012;
  ctx.beginPath();
  ctx.moveTo(0, 0.02);
  ctx.lineTo(elbowX, elbowY);
  ctx.lineTo(wristX, wristY);
  ctx.stroke();
}

function drawShoulderPad(ctx, p, pal, deform) {
  const size = p.size || 0.3;
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, TAU);
  ctx.fillStyle = createLitGradient(ctx, pal, deform.hueShift, size, 0.9);
  ctx.fill();
  drawDepthOutline(ctx, pal, deform.hueShift, 0.03);
  drawSpecular(ctx, pal, deform.hueShift, LIGHT_NX * size * 0.3, LIGHT_NY * size * 0.3, size * 0.35);
}

function drawThickArm(ctx, p, pal, deform) {
  const len = p.length || 0.25;
  ctx.beginPath();
  ctx.ellipse(0, len * 0.5, 0.12, len * 0.5, 0, 0, TAU);
  ctx.fillStyle = createLitGradient(ctx, pal, deform.hueShift, len * 0.5, 0.85);
  ctx.fill();
  drawDepthOutline(ctx, pal, deform.hueShift, 0.03);
}

function drawNub(ctx, p, pal, deform) {
  const size = p.size || 0.2;
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, TAU);
  ctx.fillStyle = createLitGradient(ctx, pal, deform.hueShift, size, 0.8);
  ctx.fill();
  drawDepthOutline(ctx, pal, deform.hueShift, 0.02);
}

// ── Eye attachment drawer ──

function drawEyeAttachment(ctx, att, pal, deform, exprParams, facing, boneRot, radius) {
  const p = att.params;
  const style = p.style;
  const side = p.side === 'left' ? -1 : 1;
  const eyeSize = p.size || 0.18;
  const offset = p.offset || 0.3;
  const spread = p.spread || 0.5;

  // Expression modifiers
  let openness = 1;
  let glowIntensity = 1;
  let blinkAmount = 0;
  if (exprParams) {
    openness = exprParams.eyeParams.openness !== undefined ? exprParams.eyeParams.openness : 1;
    glowIntensity = exprParams.eyeParams.glow !== undefined ? exprParams.eyeParams.glow : 1;
    blinkAmount = exprParams.blinkAmount || 0;
  }

  // Blink reduces openness
  openness *= (1 - blinkAmount);

  if (openness < 0.05) return; // fully closed

  // Eye position relative to face anchor bone (already transformed)
  // Local offset from face_anchor center
  const localFacing = facing - boneRot; // face direction in bone-local space
  const eyeAngle = localFacing + side * spread / 2;
  const ex = Math.cos(localFacing) * offset * 0.6 + Math.cos(eyeAngle) * offset * 0.4 * side;
  const ey = Math.sin(localFacing) * offset * 0.6 + Math.sin(eyeAngle) * offset * 0.4 * side;

  const eyeR = eyeSize * openness;
  if (eyeR < 0.01) return;

  // Death shrinks eyes
  const deathScale = deform.isDying ? Math.max(0, 1 - (deform.death?.progress || 0)) : 1;
  const finalR = eyeR * deathScale;
  if (finalR < 0.01) return;

  if (style === 'void') {
    // Dark skull-socket void — hollow, menacing
    const voidR = finalR * 1.3;
    // Outer dark void
    ctx.beginPath();
    ctx.ellipse(ex, ey, voidR, voidR * 1.25, 0, 0, TAU);
    ctx.fillStyle = colorToCSS(pal.interior, 0, 0.8);
    ctx.fill();
    // Inner darker core
    ctx.beginPath();
    ctx.ellipse(ex, ey, voidR * 0.6, voidR * 0.7, 0, 0, TAU);
    ctx.fillStyle = `rgba(5,0,10,${0.7 * openness})`;
    ctx.fill();
    // Faint glow deep inside — hint of spectral energy
    if (glowIntensity > 0.3) {
      ctx.beginPath();
      ctx.arc(ex, ey, voidR * 0.3, 0, TAU);
      const vGrad = ctx.createRadialGradient(ex, ey, 0, ex, ey, voidR * 0.3);
      vGrad.addColorStop(0, colorToCSS(pal.eye, 0, 0.3 * glowIntensity));
      vGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = vGrad;
      ctx.fill();
    }

  } else if (style === 'dot') {
    ctx.beginPath();
    ctx.arc(ex, ey, finalR, 0, TAU);
    ctx.fillStyle = colorToCSS(pal.eye, 0);
    ctx.fill();
    // Highlight
    ctx.beginPath();
    ctx.arc(ex - finalR * 0.25, ey - finalR * 0.25, finalR * 0.35, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();

  } else if (style === 'glow') {
    const gr = finalR * 1.5 * glowIntensity;
    const grad = ctx.createRadialGradient(ex, ey, 0, ex, ey, gr);
    grad.addColorStop(0, colorToCSS(pal.eye, 0, 0.9 * glowIntensity));
    grad.addColorStop(0.6, colorToCSS(pal.eye, 0, 0.4 * glowIntensity));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ex, ey, gr, 0, TAU);
    ctx.fill();

  } else if (style === 'slit') {
    const slitWidth = (exprParams?.eyeParams?.slitWidth) || 0.4;
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(localFacing);
    ctx.scale(slitWidth, 1);
    ctx.beginPath();
    ctx.arc(0, 0, finalR, 0, TAU);
    ctx.fillStyle = colorToCSS(pal.eye, 0);
    ctx.fill();
    ctx.restore();
    // Outer glow
    ctx.beginPath();
    ctx.arc(ex, ey, finalR * 1.2, 0, TAU);
    ctx.fillStyle = colorToCSS(pal.highlight, 0, 0.2);
    ctx.fill();

  } else if (style === 'angry') {
    ctx.beginPath();
    ctx.arc(ex, ey, finalR, 0, TAU);
    ctx.fillStyle = colorToCSS(pal.eye, 0);
    ctx.fill();
    // Brow
    const browAngle = exprParams?.browParams?.angle || -0.1;
    const browThickness = exprParams?.browParams?.thickness || 1;
    ctx.strokeStyle = colorToCSS(pal.base, deform.hueShift, 0.8);
    ctx.lineWidth = Math.max(0.03, finalR * 0.5 * browThickness);
    ctx.beginPath();
    const browY = ey - finalR * 1.6;
    ctx.moveTo(ex - finalR * 1.2, browY - side * finalR * 0.5 + browAngle * finalR * 2);
    ctx.lineTo(ex + finalR * 0.8, browY + side * finalR * 0.3 + browAngle * finalR);
    ctx.stroke();
  }
}

// ── Feature attachment drawer ──

function drawFeatureAttachment(ctx, att, pal, deform, radius) {
  const p = att.params;
  const r = p.radius || 0.5;
  const ox = p.offsetX || 0;
  const oy = p.offsetY || 0;

  switch (p.featureType) {
    case 'dark_interior':
    case 'interior_glow': {
      if (p.featureType === 'interior_glow') {
        // Radial gradient for ghost interior
        const grad = ctx.createRadialGradient(ox, oy - 0.1, 0, ox, oy - 0.1, r);
        grad.addColorStop(0, colorToCSS(pal.highlight, deform.hueShift, 0.3));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = colorToCSS(pal.interior, deform.hueShift, 0.6);
      }
      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, TAU);
      ctx.fill();
      break;
    }
    case 'highlight': {
      ctx.fillStyle = colorToCSS(pal.highlight, deform.hueShift, 0.4);
      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, TAU);
      ctx.fill();
      break;
    }
    case 'hot_core': {
      // Ember inner core
      ctx.beginPath();
      ctx.arc(0, 0.15, r, 0, TAU);
      ctx.fillStyle = colorToCSS(pal.interior, deform.hueShift, 0.7);
      ctx.fill();
      // Bright center
      ctx.beginPath();
      ctx.arc(0, 0.1, r * 0.55, 0, TAU);
      ctx.fillStyle = colorToCSS(pal.highlight, deform.hueShift, 0.5);
      ctx.fill();
      break;
    }
    default:
      break;
  }
}

// ── Accent attachment drawer ──

function drawAccentAttachment(ctx, att, pal, deform, variation, radius) {
  const p = att.params;

  switch (p.accentType) {
    case 'glow': {
      const glowR = p.radius || 2.5;
      const [gr, gg, gb, ga] = pal.glow;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR);
      grad.addColorStop(0, `rgba(${gr * 255 | 0}, ${gg * 255 | 0}, ${gb * 255 | 0}, ${ga})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(-glowR, -glowR, glowR * 2, glowR * 2);
      ctx.restore();
      break;
    }
    case 'wisp': {
      // Ragged trailing wisp tendril — longer and more dramatic
      const wGrad = ctx.createLinearGradient(0, -0.05, 0, 0.5);
      wGrad.addColorStop(0, colorToCSS(pal.base, deform.hueShift, 0.5));
      wGrad.addColorStop(1, colorToCSS(pal.base, deform.hueShift, 0.08));
      ctx.fillStyle = wGrad;
      ctx.beginPath();
      ctx.moveTo(0.05, -0.05);
      ctx.quadraticCurveTo(0.07, 0.12, 0.03, 0.3);
      ctx.lineTo(0.0, 0.45);
      ctx.lineTo(-0.04, 0.5);
      ctx.lineTo(-0.02, 0.3);
      ctx.quadraticCurveTo(-0.06, 0.1, -0.05, -0.05);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'trail': {
      // Multiple ragged trailing cloak strips — longer, fading
      const tGrad = ctx.createLinearGradient(0, -0.05, 0, 0.65);
      tGrad.addColorStop(0, colorToCSS(pal.base, deform.hueShift, 0.4));
      tGrad.addColorStop(1, colorToCSS(pal.base, deform.hueShift, 0.05));
      ctx.fillStyle = tGrad;
      ctx.beginPath();
      ctx.moveTo(0.1, -0.05);
      ctx.quadraticCurveTo(0.12, 0.2, 0.05, 0.45);
      ctx.lineTo(0.0, 0.6);
      ctx.lineTo(-0.04, 0.55);
      ctx.lineTo(-0.06, 0.35);
      ctx.quadraticCurveTo(-0.09, 0.12, -0.08, -0.05);
      ctx.closePath();
      ctx.fill();
      // Second strip
      const t2Grad = ctx.createLinearGradient(0, 0, 0, 0.55);
      t2Grad.addColorStop(0, colorToCSS(pal.interior, deform.hueShift, 0.3));
      t2Grad.addColorStop(1, colorToCSS(pal.interior, deform.hueShift, 0.03));
      ctx.fillStyle = t2Grad;
      ctx.beginPath();
      ctx.moveTo(-0.12, 0);
      ctx.quadraticCurveTo(-0.14, 0.25, -0.1, 0.5);
      ctx.lineTo(-0.06, 0.4);
      ctx.quadraticCurveTo(-0.08, 0.15, -0.07, 0);
      ctx.closePath();
      ctx.fill();
      // Third strip
      ctx.fillStyle = t2Grad;
      ctx.beginPath();
      ctx.moveTo(0.14, 0.02);
      ctx.quadraticCurveTo(0.16, 0.2, 0.12, 0.45);
      ctx.lineTo(0.08, 0.35);
      ctx.quadraticCurveTo(0.1, 0.15, 0.1, 0.02);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'crest_spike': {
      // Jagged streaming spike fragment — like a torn flame/horn
      const len = p.length || 0.3;
      const angle = p.angle || 0;
      ctx.save();
      ctx.rotate(angle);
      // Spiky, irregular shape
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-0.04, -len * 0.3);
      ctx.lineTo(-0.07, -len * 0.6);
      ctx.lineTo(-0.03, -len * 0.75);
      ctx.lineTo(-0.06, -len);           // sharp tip
      ctx.lineTo(0.0, -len * 0.85);
      ctx.lineTo(0.04, -len * 0.95);     // secondary spike
      ctx.lineTo(0.03, -len * 0.65);
      ctx.lineTo(0.06, -len * 0.4);
      ctx.lineTo(0.03, -len * 0.2);
      ctx.closePath();
      const cGrad = ctx.createLinearGradient(0, 0, 0, -len);
      cGrad.addColorStop(0, colorToCSS(pal.base, 0, 0.7));
      cGrad.addColorStop(0.6, colorToCSS(pal.highlight, 0, 0.5));
      cGrad.addColorStop(1, colorToCSS(pal.highlight, 0, 0.15));
      ctx.fillStyle = cGrad;
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'flame_tip': {
      const size = p.size || 0.4;
      ctx.fillStyle = colorToCSS(pal.highlight, deform.hueShift, 0.7);
      ctx.beginPath();
      // Teardrop-ish flame tip
      ctx.moveTo(0, -size);
      ctx.quadraticCurveTo(size * 0.6, -size * 0.3, size * 0.3, size * 0.3);
      ctx.quadraticCurveTo(0, size * 0.5, -size * 0.3, size * 0.3);
      ctx.quadraticCurveTo(-size * 0.6, -size * 0.3, 0, -size);
      ctx.closePath();
      ctx.fill();
      break;
    }
    default:
      break;
  }
}

// ══════════════════════════════════════════════════════════
//  Legacy drawing (unchanged from original)
// ══════════════════════════════════════════════════════════

function drawCreatureLegacy(ctx, model) {
  const { archetype, deform, x, y, radius, facing } = model;

  ctx.save();

  if (deform.opacity < 1) {
    ctx.globalAlpha = Math.max(0, deform.opacity);
  }

  drawGlow(ctx, x, y, radius, archetype.palette, deform);

  // Drop shadow
  if (!deform.isDying) {
    drawDropShadow(ctx, x, y, radius * deform.scaleX);
  }

  ctx.save();
  ctx.translate(x, y);

  if (deform.rotation && (deform.scaleX !== 1 || deform.scaleY !== 1)) {
    ctx.rotate(deform.rotation);
    ctx.scale(deform.scaleX, deform.scaleY);
    ctx.rotate(-deform.rotation);
  } else {
    ctx.scale(deform.scaleX, deform.scaleY);
  }

  const shape = archetype.body.shape;
  if (shape === 'blob') drawBlob(ctx, radius, archetype, deform, model);
  else if (shape === 'wisp') drawWisp(ctx, radius, archetype, deform, model);
  else if (shape === 'flame') drawFlame(ctx, radius, archetype, deform, model);
  else if (shape === 'hulk') drawHulk(ctx, radius, archetype, deform, model);

  drawEyes(ctx, radius, archetype, deform, facing);

  ctx.restore();

  if (deform.flash > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255, 255, 255, ${deform.flash * 0.6})`;
    ctx.beginPath();
    ctx.arc(x, y, radius * deform.scaleX * 1.1, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  if (model.hp < model.maxHp && !deform.isDying) {
    drawHPBar(ctx, x, y - radius * deform.scaleY - 8, radius * 1.5, model.hp, model.maxHp);
  }

  ctx.restore();
}

// ── Legacy glow ──

function drawGlow(ctx, x, y, r, palette, deform) {
  const [gr, gg, gb, ga] = palette.glow;
  const glowR = r * 2.5 * deform.scaleX;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const grad = ctx.createRadialGradient(x, y, 0, x, y, glowR);
  grad.addColorStop(0, `rgba(${gr * 255 | 0}, ${gg * 255 | 0}, ${gb * 255 | 0}, ${ga})`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(x - glowR, y - glowR, glowR * 2, glowR * 2);
  ctx.restore();
}

// ── Legacy shapes ──

function drawBlob(ctx, r, archetype, deform, model) {
  const segments = archetype.body.segments;
  const pal = archetype.palette;

  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * TAU;
    const wobbleMul = deform.wobbleAt(angle);
    const pr = r * wobbleMul;
    const px = Math.cos(angle) * pr;
    const py = Math.sin(angle) * pr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = colorToCSS(pal.base, deform.hueShift);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 0, r * 0.55, 0, TAU);
  ctx.fillStyle = colorToCSS(pal.interior, deform.hueShift);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(-r * 0.2, -r * 0.25, r * 0.25, 0, TAU);
  ctx.fillStyle = colorToCSS(pal.highlight, deform.hueShift, 0.4);
  ctx.fill();

  if (deform.death && deform.death.type === 'splat' && deform.death.progress > 0.3) {
    const p = deform.death.progress;
    ctx.strokeStyle = colorToCSS(pal.base, deform.hueShift, 0.3 * (1 - p));
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * (1.2 + p * 0.5), 0, TAU);
    ctx.stroke();
  }
}

function drawWisp(ctx, r, archetype, deform, model) {
  const pal = archetype.palette;
  const tailWaves = archetype.body.tailWaves || 3;
  const tailLen = archetype.body.tailLength || 0.6;

  ctx.beginPath();

  const domeSegments = 10;
  for (let i = 0; i <= domeSegments; i++) {
    const t = i / domeSegments;
    const angle = Math.PI + t * Math.PI;
    const wobbleMul = deform.wobbleAt(angle);
    const px = Math.cos(angle) * r * wobbleMul;
    const py = Math.sin(angle) * r * wobbleMul * 0.9;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }

  const tailSegments = 16;
  const tailBottom = r * tailLen;
  for (let i = 0; i <= tailSegments; i++) {
    const t = i / tailSegments;
    const xPos = r * (1 - 2 * t);
    const wavePhase = (model.variation.tailWaveOffset || 0);
    const wave = Math.sin(t * tailWaves * TAU + wavePhase + deform.wobbleAt(t * TAU) * 2) * r * 0.25;
    const yPos = tailBottom + wave * (0.5 + t * 0.5);
    ctx.lineTo(xPos, yPos);
  }

  ctx.closePath();
  ctx.fillStyle = colorToCSS(pal.base, deform.hueShift, deform.opacity * 0.85);
  ctx.fill();

  const grad = ctx.createRadialGradient(0, -r * 0.1, 0, 0, -r * 0.1, r * 0.6);
  grad.addColorStop(0, colorToCSS(pal.highlight, deform.hueShift, 0.3));
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, -r * 0.1, r * 0.6, 0, TAU);
  ctx.fill();
}

function drawFlame(ctx, r, archetype, deform, model) {
  const pal = archetype.palette;
  const flickerPoints = archetype.body.flickerPoints || 4;
  const flickerSpeed = model.variation.flickerSpeed || 1;

  ctx.beginPath();
  const segments = archetype.body.segments;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = t * TAU - Math.PI / 2;
    let baseR = r;
    const verticalT = (Math.sin(angle) + 1) / 2;
    baseR *= 0.6 + verticalT * 0.5;
    const flickerAngle = angle * flickerPoints + deform.wobbleAt(angle) * 3;
    const flicker = Math.sin(flickerAngle * flickerSpeed) * r * 0.15;
    const wobbleMul = deform.wobbleAt(angle);
    const finalR = (baseR + flicker) * wobbleMul;
    const px = Math.cos(angle) * finalR;
    const py = Math.sin(angle) * finalR;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = colorToCSS(pal.base, deform.hueShift);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, r * 0.15, r * 0.45, 0, TAU);
  ctx.fillStyle = colorToCSS(pal.interior, deform.hueShift, 0.7);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, r * 0.1, r * 0.25, 0, TAU);
  ctx.fillStyle = colorToCSS(pal.highlight, deform.hueShift, 0.5);
  ctx.fill();

  if (deform.death && deform.death.type === 'puff' && deform.death.scatter > 0) {
    const scatter = deform.death.scatter;
    const p = deform.death.progress;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + p * 2;
      const d = scatter * (0.5 + Math.sin(i * 3.7) * 0.5);
      const px = Math.cos(a) * d;
      const py = Math.sin(a) * d;
      const pr = r * 0.2 * (1 - p);
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, TAU);
      ctx.fillStyle = colorToCSS(pal.base, deform.hueShift, (1 - p) * 0.6);
      ctx.fill();
    }
  }
}

function drawHulk(ctx, r, archetype, deform, model) {
  const pal = archetype.palette;
  const spikes = archetype.body.spikes || 4;
  const spikeLen = (archetype.body.spikeLength || 0.25) * (model.variation.spikeJitter || 1);

  ctx.beginPath();
  const segments = archetype.body.segments;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * TAU;
    const wobbleMul = deform.wobbleAt(angle);
    let spikeBonus = 0;
    for (let s = 0; s < spikes; s++) {
      const spikeAngle = (s / spikes) * TAU;
      const diff = Math.abs(((angle - spikeAngle + Math.PI) % TAU) - Math.PI);
      if (diff < 0.4) {
        spikeBonus = spikeLen * r * (1 - diff / 0.4);
      }
    }
    const pr = (r + spikeBonus) * wobbleMul;
    const px = Math.cos(angle) * pr;
    const py = Math.sin(angle) * pr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = colorToCSS(pal.base, deform.hueShift);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 0, r * 0.5, 0, TAU);
  ctx.fillStyle = colorToCSS(pal.interior, deform.hueShift, 0.6);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(-r * 0.15, -r * 0.2, r * 0.2, 0, TAU);
  ctx.fillStyle = colorToCSS(pal.highlight, deform.hueShift, 0.25);
  ctx.fill();

  if (deform.death && deform.death.type === 'crumble' && deform.death.scatter > 0) {
    const scatter = deform.death.scatter;
    const p = deform.death.progress;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + i * 1.3;
      const d = scatter * (0.3 + (i % 3) * 0.25);
      const px = Math.cos(a) * d;
      const py = Math.sin(a) * d + (deform.death.yOffset || 0) * (i * 0.3);
      const chunkR = r * (0.15 + (i % 2) * 0.1) * (1 - p * 0.5);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(i * 1.1 + p * 2);
      ctx.fillRect(-chunkR, -chunkR, chunkR * 2, chunkR * 1.5);
      ctx.restore();
      ctx.fillStyle = colorToCSS(pal.base, deform.hueShift, (1 - p) * 0.7);
      ctx.fill();
    }
  }
}

// ── Legacy eyes ──

function drawEyes(ctx, r, archetype, deform, facing) {
  const eyes = archetype.eyes;
  if (!eyes || eyes.count === 0) return;
  const pal = archetype.palette;
  const eyeR = r * eyes.size * (deform.isDying ? (1 - (deform.death?.progress || 0)) : 1);
  if (eyeR < 0.5) return;
  const offset = r * eyes.offset;

  for (let i = 0; i < eyes.count; i++) {
    const side = i === 0 ? -1 : 1;
    const eyeAngle = facing + side * eyes.spread / 2;
    const ex = Math.cos(facing) * offset * 0.6 + Math.cos(eyeAngle) * offset * 0.4 * side;
    const ey = Math.sin(facing) * offset * 0.6 + Math.sin(eyeAngle) * offset * 0.4 * side;

    if (eyes.style === 'dot') {
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR, 0, TAU);
      ctx.fillStyle = colorToCSS(pal.eye, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex - eyeR * 0.25, ey - eyeR * 0.25, eyeR * 0.35, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fill();
    } else if (eyes.style === 'glow') {
      const grad = ctx.createRadialGradient(ex, ey, 0, ex, ey, eyeR * 1.5);
      grad.addColorStop(0, colorToCSS(pal.eye, 0, 0.9));
      grad.addColorStop(0.6, colorToCSS(pal.eye, 0, 0.4));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR * 1.5, 0, TAU);
      ctx.fill();
    } else if (eyes.style === 'slit') {
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(facing);
      ctx.scale(0.4, 1);
      ctx.beginPath();
      ctx.arc(0, 0, eyeR, 0, TAU);
      ctx.fillStyle = colorToCSS(pal.eye, 0);
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR * 1.2, 0, TAU);
      ctx.fillStyle = colorToCSS(pal.highlight, 0, 0.2);
      ctx.fill();
    } else if (eyes.style === 'angry') {
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR, 0, TAU);
      ctx.fillStyle = colorToCSS(pal.eye, 0);
      ctx.fill();
      ctx.strokeStyle = colorToCSS(pal.base, deform.hueShift, 0.8);
      ctx.lineWidth = Math.max(1.5, eyeR * 0.5);
      ctx.beginPath();
      const browY = ey - eyeR * 1.6;
      ctx.moveTo(ex - eyeR * 1.2, browY - side * eyeR * 0.5);
      ctx.lineTo(ex + eyeR * 0.8, browY + side * eyeR * 0.3);
      ctx.stroke();
    }
  }
}

// ── HP Bar ──

function drawHPBar(ctx, x, y, width, hp, maxHp) {
  const ratio = Math.max(0, hp / maxHp);
  const barH = 3;
  const bx = x - width / 2;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(bx, y, width, barH);

  ctx.fillStyle = ratio > 0.3 ? '#4f4' : '#f44';
  ctx.fillRect(bx, y, width * ratio, barH);
}

// ── Color Helpers ──

function colorToCSS(rgb, hueShift = 0, alpha = 1) {
  let [r, g, b] = rgb;

  if (hueShift !== 0) {
    const cos = Math.cos(hueShift * TAU);
    const sin = Math.sin(hueShift * TAU);
    const nr = r * (0.667 + cos * 0.333) + g * (0.333 - cos * 0.333 + sin * 0.577) + b * (0.333 - cos * 0.333 - sin * 0.577);
    const ng = r * (0.333 - cos * 0.333 - sin * 0.577) + g * (0.667 + cos * 0.333) + b * (0.333 - cos * 0.333 + sin * 0.577);
    const nb = r * (0.333 - cos * 0.333 + sin * 0.577) + g * (0.333 - cos * 0.333 - sin * 0.577) + b * (0.667 + cos * 0.333);
    r = Math.max(0, Math.min(1, nr));
    g = Math.max(0, Math.min(1, ng));
    b = Math.max(0, Math.min(1, nb));
  }

  const ri = r * 255 | 0;
  const gi = g * 255 | 0;
  const bi = b * 255 | 0;

  if (alpha >= 1) return `rgb(${ri},${gi},${bi})`;
  return `rgba(${ri},${gi},${bi},${alpha.toFixed(3)})`;
}
