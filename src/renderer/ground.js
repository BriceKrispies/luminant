/**
 * Ground layer — pixel-art tiled terrain.
 *
 * Three layers:
 *   1. Base floor: tiled stone/dirt pattern (16x16 world units)
 *   2. Breakup: sparse cracks/moss variation (~20% coverage)
 *   3. Props: tiny pebbles/grass tufts (~5-10% coverage)
 *
 * All variation is deterministic from tile coordinates (no flicker).
 * Colors are cool-toned, low-contrast, desaturated — never competes
 * with entities.
 */

const TILE = 16; // world units per tile

// ── Deterministic hash ──

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296; // [0, 1)
}

function hash2(x, y) {
  let h = (x * 1103515245 + y * 12345 + 7) | 0;
  h = ((h ^ (h >> 11)) * 2654435761) | 0;
  return ((h ^ (h >> 15)) >>> 0) / 4294967296;
}

// ── Tile atlas (prerendered) ──

const ATLAS_TILES = 4;   // number of base tile variants
const ATLAS_PX = 16;     // pixels per tile in the atlas
let atlas = null;
let atlasCtx = null;

// Base floor colors (cool blue-gray / purple-gray)
const BASE_COLORS = [
  [18, 17, 24],  // darkest
  [21, 20, 27],  // dark
  [20, 19, 26],  // medium
  [23, 21, 28],  // slightly lighter
];

// Breakup colors (very subtle variation)
const CRACK_COLOR = [15, 14, 20];   // darker crack
const MOSS_COLOR = [22, 24, 22];    // desaturated green-gray

// Prop colors
const PEBBLE_COLOR = [26, 24, 30];  // muted light gray-purple
const GRASS_COLOR = [20, 25, 20];   // very muted green-gray

function buildAtlas() {
  if (typeof document === 'undefined') return;
  atlas = document.createElement('canvas');
  atlas.width = ATLAS_PX * ATLAS_TILES;
  atlas.height = ATLAS_PX;
  atlasCtx = atlas.getContext('2d');
  atlasCtx.imageSmoothingEnabled = false;

  const img = atlasCtx.createImageData(ATLAS_PX * ATLAS_TILES, ATLAS_PX);
  const d = img.data;

  for (let variant = 0; variant < ATLAS_TILES; variant++) {
    const baseCol = BASE_COLORS[variant];
    const ox = variant * ATLAS_PX;

    for (let py = 0; py < ATLAS_PX; py++) {
      for (let px = 0; px < ATLAS_PX; px++) {
        const idx = ((py * ATLAS_PX * ATLAS_TILES) + ox + px) * 4;

        // Base color with subtle per-pixel cluster variation
        // Group pixels into 2x2 clusters for readable pixel-art look
        const cx = (px >> 1);
        const cy = (py >> 1);
        const clusterHash = hash(cx + variant * 31, cy + variant * 17);

        let r = baseCol[0];
        let g = baseCol[1];
        let b = baseCol[2];

        // Subtle cluster variation (+-2 per channel)
        const shift = (clusterHash * 5 - 2.5) | 0;
        r += shift;
        g += shift;
        b += shift + 1; // slight blue bias

        d[idx] = r;
        d[idx + 1] = g;
        d[idx + 2] = b;
        d[idx + 3] = 255;
      }
    }
  }

  atlasCtx.putImageData(img, 0, 0);
}

// ── Main draw ──

export function drawGround(ctx, view, camera) {
  if (!atlas) buildAtlas();
  if (!atlas) return;

  ctx.imageSmoothingEnabled = false;

  const startTX = Math.floor(view.left / TILE);
  const startTY = Math.floor(view.top / TILE);
  const endTX = Math.ceil(view.right / TILE);
  const endTY = Math.ceil(view.bottom / TILE);

  // Layer 1: Base floor tiles
  for (let ty = startTY; ty <= endTY; ty++) {
    for (let tx = startTX; tx <= endTX; tx++) {
      const variant = (hash(tx, ty) * ATLAS_TILES) | 0;
      const sx = variant * ATLAS_PX;

      ctx.drawImage(
        atlas,
        sx, 0, ATLAS_PX, ATLAS_PX,          // source rect in atlas
        tx * TILE, ty * TILE, TILE, TILE     // dest rect in world
      );
    }
  }

  // Layer 2: Breakup — sparse cracks and moss patches
  for (let ty = startTY; ty <= endTY; ty++) {
    for (let tx = startTX; tx <= endTX; tx++) {
      const h = hash2(tx, ty);
      if (h > 0.20) continue; // ~20% coverage

      const wx = tx * TILE;
      const wy = ty * TILE;

      if (h < 0.08) {
        // Crack: horizontal or vertical line, 1px wide
        drawCrack(ctx, wx, wy, tx, ty);
      } else if (h < 0.14) {
        // Moss patch: small cluster of slightly different pixels
        drawMoss(ctx, wx, wy, tx, ty);
      } else {
        // Worn path: lighter rectangular area
        drawWornSpot(ctx, wx, wy, tx, ty);
      }
    }
  }

  // Layer 3: Sparse props — pebbles and grass tufts
  for (let ty = startTY; ty <= endTY; ty++) {
    for (let tx = startTX; tx <= endTX; tx++) {
      const h = hash(tx + 9999, ty + 7777);
      if (h > 0.07) continue; // ~7% coverage

      const wx = tx * TILE;
      const wy = ty * TILE;

      if (h < 0.035) {
        drawPebble(ctx, wx, wy, tx, ty);
      } else {
        drawGrassTuft(ctx, wx, wy, tx, ty);
      }
    }
  }

  ctx.imageSmoothingEnabled = true;
}

// ── Layer 2: Breakup detail drawers ──

function drawCrack(ctx, wx, wy, tx, ty) {
  const col = `rgb(${CRACK_COLOR[0]},${CRACK_COLOR[1]},${CRACK_COLOR[2]})`;
  ctx.fillStyle = col;
  const h = hash(tx * 3, ty * 5);
  const horizontal = h > 0.5;

  if (horizontal) {
    // Horizontal crack across tile, slightly jagged
    const y0 = wy + 4 + ((h * 8) | 0);
    ctx.fillRect(wx + 2, y0, 4, 1);
    ctx.fillRect(wx + 5, y0 + (hash(tx + 1, ty) > 0.5 ? 1 : -1), 5, 1);
    ctx.fillRect(wx + 9, y0, 3, 1);
  } else {
    // Vertical crack
    const x0 = wx + 4 + ((h * 8) | 0);
    ctx.fillRect(x0, wy + 2, 1, 4);
    ctx.fillRect(x0 + (hash(tx, ty + 1) > 0.5 ? 1 : -1), wy + 5, 1, 5);
    ctx.fillRect(x0, wy + 9, 1, 3);
  }
}

function drawMoss(ctx, wx, wy, tx, ty) {
  const col = `rgb(${MOSS_COLOR[0]},${MOSS_COLOR[1]},${MOSS_COLOR[2]})`;
  ctx.fillStyle = col;
  // Small 3x3 or 4x3 cluster, position varies per tile
  const ox = 3 + ((hash(tx * 7, ty) * 8) | 0);
  const oy = 3 + ((hash(tx, ty * 7) * 8) | 0);
  ctx.fillRect(wx + ox, wy + oy, 3, 2);
  ctx.fillRect(wx + ox + 1, wy + oy + 2, 2, 1);
}

function drawWornSpot(ctx, wx, wy, tx, ty) {
  // Slightly lighter rectangular area — worn stone
  ctx.fillStyle = 'rgb(25, 23, 30)';
  const ox = 2 + ((hash(tx * 11, ty * 3) * 6) | 0);
  const oy = 2 + ((hash(tx * 3, ty * 11) * 6) | 0);
  ctx.fillRect(wx + ox, wy + oy, 4, 3);
}

// ── Layer 3: Prop drawers ──

function drawPebble(ctx, wx, wy, tx, ty) {
  const col = `rgb(${PEBBLE_COLOR[0]},${PEBBLE_COLOR[1]},${PEBBLE_COLOR[2]})`;
  ctx.fillStyle = col;
  const ox = 2 + ((hash(tx * 13, ty * 17) * 10) | 0);
  const oy = 2 + ((hash(tx * 17, ty * 13) * 10) | 0);
  // 2x1 or 1x1 pebble
  const wide = hash(tx + 50, ty + 50) > 0.5;
  ctx.fillRect(wx + ox, wy + oy, wide ? 2 : 1, 1);
}

function drawGrassTuft(ctx, wx, wy, tx, ty) {
  const col = `rgb(${GRASS_COLOR[0]},${GRASS_COLOR[1]},${GRASS_COLOR[2]})`;
  ctx.fillStyle = col;
  const ox = 3 + ((hash(tx * 19, ty * 23) * 8) | 0);
  const oy = 4 + ((hash(tx * 23, ty * 19) * 8) | 0);
  // Two small vertical pixels — tiny tuft
  ctx.fillRect(wx + ox, wy + oy, 1, 2);
  ctx.fillRect(wx + ox + 1, wy + oy + 1, 1, 1);
}
