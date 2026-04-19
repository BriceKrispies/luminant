/**
 * Time-independent portions of the per-archetype body art, extracted so the
 * sprite atlas can bake them into offscreen canvases once and blit them per
 * frame.
 *
 * These routines take a palette and draw centered at (cx, cy) — no reliance on
 * skeletons, deformations, or time. The time-varying bits (wisp trails, flame
 * sparks, hit flash, eyes, HP, progression effects) remain on the per-entity
 * hot path in draw-pixel.js.
 */

// ── Color helpers (duplicated minimally to avoid touching draw-pixel's hot path) ──

function rgb(color, alpha) {
  const r = color[0] * 255 | 0;
  const g = color[1] * 255 | 0;
  const b = color[2] * 255 | 0;
  if (alpha !== undefined && alpha < 1) {
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return `rgb(${r},${g},${b})`;
}

function pxS(ctx, x, y, color, alpha) {
  ctx.fillStyle = rgb(color, alpha);
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
}

function pxCircleS(ctx, cx, cy, r, color, alpha) {
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

function pxEllipseS(ctx, cx, cy, rx, ry, color, alpha) {
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

// ── Bakeable bodies ──

export function drawPixelBlobStatic(ctx, cx, cy, pal) {
  const r = 6;
  pxEllipseS(ctx, cx, cy + r + 1, r - 1, 2, [0, 0, 0], 0.3);
  pxCircleS(ctx, cx, cy, r, pal.base);
  pxCircleS(ctx, cx + 1, cy + 1, r - 2, pal.interior);
  pxCircleS(ctx, cx - 1, cy - 1, r - 2, pal.base);
  pxCircleS(ctx, cx - 2, cy - 2, r - 4, pal.highlight);
  pxS(ctx, cx - 2, cy - 3, [1, 1, 1], 0.7);
  pxS(ctx, cx - 1, cy - 3, [1, 1, 1], 0.5);
}

export function drawPixelWispStatic(ctx, cx, cy, pal) {
  const headY = cy - 3;
  pxEllipseS(ctx, cx, cy + 9, 3, 1, [0, 0, 0], 0.15);
  pxEllipseS(ctx, cx, headY, 4, 4, pal.base);
  pxEllipseS(ctx, cx, headY + 1, 3, 3, pal.interior);
  pxEllipseS(ctx, cx - 1, headY - 1, 2, 2, pal.highlight);

  for (let dy = 0; dy < 7; dy++) {
    const width = Math.max(1, 4 - dy * 0.5);
    const y = headY + 4 + dy;
    for (let dx = -width; dx <= width; dx++) {
      pxS(ctx, cx + dx, y, pal.base, 0.8 - dy * 0.05);
    }
  }
  pxS(ctx, cx - 2, headY - 2, [1, 1, 1], 0.4);
}

export function drawPixelFlameStatic(ctx, cx, cy, pal) {
  const baseY = cy + 4;
  pxEllipseS(ctx, cx, baseY + 3, 3, 1, [0, 0, 0], 0.25);

  const flameH = 12;
  for (let dy = 0; dy < flameH; dy++) {
    const t = dy / flameH;
    const width = Math.max(0, (1 - t * t) * 5);
    const y = baseY - dy;

    let color;
    if (t < 0.3) color = pal.interior;
    else if (t < 0.7) color = pal.base;
    else color = pal.highlight;

    for (let dx = -width; dx <= width; dx++) {
      pxS(ctx, cx + dx, y, color, 1 - Math.abs(dx) / (width + 1) * 0.3);
    }
  }

  pxEllipseS(ctx, cx, baseY - 3, 2, 3, pal.highlight, 0.6);
}

export function drawPixelHeroStatic(ctx, cx, cy, pal) {
  pxEllipseS(ctx, cx, cy + 7, 4, 2, [0, 0, 0], 0.3);
  pxEllipseS(ctx, cx, cy + 1, 4, 5, pal.base);
  pxEllipseS(ctx, cx + 1, cy + 2, 3, 4, pal.interior);
  pxEllipseS(ctx, cx - 1, cy, 3, 4, pal.base);
  pxEllipseS(ctx, cx - 1, cy - 1, 2, 3, pal.highlight);
  pxCircleS(ctx, cx, cy - 4, 3, pal.base);
  pxCircleS(ctx, cx - 1, cy - 5, 2, pal.highlight);
  pxEllipseS(ctx, cx - 5, cy + 1, 2, 2, pal.base);
  pxEllipseS(ctx, cx + 5, cy + 1, 2, 2, pal.base);
  pxS(ctx, cx - 2, cy - 5, [1, 1, 1], 0.7);
}
