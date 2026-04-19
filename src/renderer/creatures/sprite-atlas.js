/**
 * Creature sprite atlas — pre-rasterizes static archetype bodies into offscreen
 * canvases and blits them with drawImage instead of re-running per-pixel fill
 * loops for every entity each frame.
 *
 * Per-pixel `fillRect(..., 1, 1)` loops in draw-pixel.js are the dominant cost
 * at high entity counts: a single r=6 `pxCircle` issues ~113 fillRect calls;
 * a slime body is ~430 fillRects per entity per frame. This module reduces
 * each creature body to 1 `drawImage` call after a one-time bake.
 *
 * Dynamic per-entity bits (eyes, HP bar, hit flash, progression effects, and
 * time-varying trails/flicker) stay on the per-entity path and are drawn
 * on top of the cached body.
 *
 * Works in any environment that exposes `OffscreenCanvas` or
 * `document.createElement('canvas')`. In environments without either (e.g.
 * Node `canvas` package in the studio renderer) the atlas is inert and
 * callers fall back to the legacy direct-draw path.
 */

import { ARCHETYPES } from './archetypes.js';
import {
  drawPixelBlobStatic,
  drawPixelHeroStatic,
  drawPixelWispStatic,
  drawPixelFlameStatic,
} from './draw-pixel-static.js';

// Sprite bounds per archetype — enough padding to fit body + shadow + shading.
// The creature center maps to (halfW, halfH) within the sprite.
const BOUNDS = {
  slime:  { halfW: 10, halfH: 11 },
  ghost:  { halfW:  8, halfH: 14 },
  ember:  { halfW:  9, halfH: 17 },
  player: { halfW:  8, halfH: 11 },
};

// Which archetype IDs have a fully-cached static body.
const CACHED_ARCHETYPES = new Set(Object.keys(BOUNDS));

// Bakers must accept (ctx, cx, cy, palette).
const BAKERS = {
  slime:  drawPixelBlobStatic,
  ghost:  drawPixelWispStatic,
  ember:  drawPixelFlameStatic,
  player: drawPixelHeroStatic,
};

const CACHE = new Map();
let offscreenUnavailable = false;

function createOffscreen(w, h) {
  if (offscreenUnavailable) return null;
  if (typeof OffscreenCanvas !== 'undefined') {
    try { return new OffscreenCanvas(w, h); } catch (_) { /* fall through */ }
  }
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  offscreenUnavailable = true;
  return null;
}

/**
 * Returns `{ canvas, halfW, halfH }` for an archetype, or `null` if the
 * archetype is not cacheable (brute/homunculus is skeleton-driven) or no
 * offscreen surface is available.
 */
export function getArchetypeSprite(archetypeId) {
  if (!CACHED_ARCHETYPES.has(archetypeId)) return null;

  const cached = CACHE.get(archetypeId);
  if (cached !== undefined) return cached;

  const bounds = BOUNDS[archetypeId];
  const archetype = ARCHETYPES[archetypeId];
  const baker = BAKERS[archetypeId];
  if (!bounds || !archetype || !baker) {
    CACHE.set(archetypeId, null);
    return null;
  }

  const w = bounds.halfW * 2 + 1;
  const h = bounds.halfH * 2 + 1;
  const canvas = createOffscreen(w, h);
  if (!canvas) {
    CACHE.set(archetypeId, null);
    return null;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    CACHE.set(archetypeId, null);
    return null;
  }

  baker(ctx, bounds.halfW, bounds.halfH, archetype.palette);

  const entry = { canvas, halfW: bounds.halfW, halfH: bounds.halfH };
  CACHE.set(archetypeId, entry);
  return entry;
}

/** Drop the entire atlas. Tests / hot reload use this. */
export function clearSpriteAtlas() {
  CACHE.clear();
  offscreenUnavailable = false;
}
