/**
 * Canvas 2D renderer backend.
 *
 * Renders to a fixed low-resolution offscreen canvas, then blits up
 * to the display canvas with nearest-neighbor scaling for a uniform
 * pixel-art look. All world-space drawing happens on the offscreen
 * canvas; the display canvas just shows the scaled result.
 *
 * Implements: init, resize, render, dispose.
 * Consumes snapshots from the engine; never reads or writes simulation state.
 */

import { drawGround } from './ground.js';
import { drawFog } from './fog.js';
import { drawLights } from './lights.js';
import { drawEntities } from './entities.js';
import { drawEffects } from './effects.js';

// Fixed render height — width computed from display aspect ratio.
// Matches WORLD_H so the static arena-fit camera lands at zoom=1, keeping
// pixel-art drawing crisp. Display blit uses nearest-neighbor to upscale.
const RENDER_HEIGHT = 540;

export function createCanvasRenderer(canvas) {
  let displayCtx = null;
  let cssW = 0;     // CSS pixel dimensions
  let cssH = 0;
  let physW = 0;    // physical pixel dimensions (CSS * dpr)
  let physH = 0;
  let resizeHandler = null;

  // Low-res offscreen canvas
  let offscreen = null;
  let offCtx = null;
  let renderW = 0;
  let renderH = 0;

  function createOffscreen() {
    if (typeof document === 'undefined') return;
    const aspect = cssW / cssH || 16 / 9;
    renderH = RENDER_HEIGHT;
    renderW = Math.round(renderH * aspect);

    offscreen = document.createElement('canvas');
    offscreen.width = renderW;
    offscreen.height = renderH;
    offCtx = offscreen.getContext('2d');
    offCtx.imageSmoothingEnabled = false;
  }

  return {
    id: 'canvas',
    name: 'Canvas 2D',

    /** Low-res render dimensions for camera/view calculations */
    get renderWidth() { return renderW; },
    get renderHeight() { return renderH; },

    async init() {
      displayCtx = canvas.getContext('2d');
      if (!displayCtx) throw new Error('Failed to get Canvas 2D context');
      this.resize();
      if (typeof window !== 'undefined') {
        resizeHandler = () => this.resize();
        window.addEventListener('resize', resizeHandler);
      }
    },

    resize() {
      const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
      const rect = canvas.getBoundingClientRect();
      cssW = rect.width;
      cssH = rect.height;
      // Set canvas backing store to physical pixel size so the browser
      // doesn't add its own interpolation layer before CSS pixelated kicks in.
      physW = Math.round(cssW * dpr);
      physH = Math.round(cssH * dpr);
      canvas.width = physW;
      canvas.height = physH;

      createOffscreen();
    },

    render(snapshot, camera) {
      if (!offCtx) return;

      // ── Draw everything to low-res offscreen canvas ──
      offCtx.setTransform(1, 0, 0, 1, 0, 0);
      offCtx.imageSmoothingEnabled = false;

      // Clear
      offCtx.fillStyle = '#0a0a0e';
      offCtx.fillRect(0, 0, renderW, renderH);

      offCtx.save();

      // Camera transform — same as before, but on the low-res canvas.
      // Camera view bounds are now computed from render dimensions,
      // so zoom maps directly.
      const view = camera.getViewBounds();
      offCtx.translate(Math.round(renderW / 2), Math.round(renderH / 2));
      offCtx.scale(camera.zoom, camera.zoom);
      offCtx.translate(-Math.round(camera.x), -Math.round(camera.y));

      // Layer 1: Ground
      drawGround(offCtx, view, camera);

      // Layer 2: Light pools
      drawLights(offCtx, snapshot, camera, view);

      // Layer 3: Entities (enemies, projectiles, pickups, player)
      drawEntities(offCtx, snapshot, camera);

      // Layer 4: Effects (hit flashes, etc.)
      drawEffects(offCtx, snapshot, camera);

      offCtx.restore();

      // Layer 5: Fog overlay (screen-space on offscreen)
      drawFog(offCtx, renderW, renderH);

      // ── Blit to display canvas with nearest-neighbor ──
      // Draw to full physical pixel size so browser doesn't interpolate.
      displayCtx.setTransform(1, 0, 0, 1, 0, 0);
      displayCtx.imageSmoothingEnabled = false;
      displayCtx.drawImage(offscreen, 0, 0, physW, physH);
    },

    dispose() {
      if (resizeHandler && typeof window !== 'undefined') {
        window.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
      }
      displayCtx = null;
      offCtx = null;
      offscreen = null;
      // Reset canvas to release 2D context
      canvas.width = canvas.width; // eslint-disable-line no-self-assign
    },

    // Expose for backward compat and debug overlay
    get width() { return physW; },
    get height() { return physH; },
    get ctx() { return displayCtx; },
    get canvas() { return canvas; },
  };
}
