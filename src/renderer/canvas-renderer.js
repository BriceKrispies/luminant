/**
 * Canvas 2D renderer backend.
 *
 * This is the original renderer refactored behind the renderer interface.
 * Implements: init, resize, render, dispose.
 * Consumes snapshots from the engine; never reads or writes simulation state.
 */

import { drawGround } from './ground.js';
import { drawFog } from './fog.js';
import { drawLights } from './lights.js';
import { drawEntities } from './entities.js';
import { drawEffects } from './effects.js';
import { drawHUD } from './ui-render.js';

export function createCanvasRenderer(canvas) {
  let ctx = null;
  let width = 0;
  let height = 0;
  let resizeHandler = null;

  return {
    id: 'canvas',
    name: 'Canvas 2D',

    async init() {
      ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to get Canvas 2D context');
      this.resize();
      if (typeof window !== 'undefined') {
        resizeHandler = () => this.resize();
        window.addEventListener('resize', resizeHandler);
      }
    },

    resize() {
      const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
      const rect = canvas.getBoundingClientRect();
      width = rect.width * dpr;
      height = rect.height * dpr;
      canvas.width = width;
      canvas.height = height;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },

    render(snapshot, camera, gameState) {
      const cw = canvas.getBoundingClientRect().width;
      const ch = canvas.getBoundingClientRect().height;

      // Clear
      ctx.fillStyle = '#0a0a0e';
      ctx.fillRect(0, 0, cw, ch);

      ctx.save();

      // Apply camera transform
      const view = camera.getViewBounds();
      ctx.translate(cw / 2, ch / 2);
      ctx.scale(camera.zoom, camera.zoom);
      ctx.translate(-camera.x, -camera.y);

      // Layer 1: Ground
      drawGround(ctx, view, camera);

      // Layer 2: Light pools
      drawLights(ctx, snapshot, camera, view);

      // Layer 3: Entities (enemies, projectiles, pickups, player)
      drawEntities(ctx, snapshot, camera);

      // Layer 4: Effects (hit flashes, etc.)
      drawEffects(ctx, snapshot, camera);

      ctx.restore();

      // Layer 5: Fog overlay (screen-space)
      drawFog(ctx, cw, ch);

      // Layer 6: HUD (screen-space)
      drawHUD(ctx, cw, ch, gameState);
    },

    dispose() {
      if (resizeHandler && typeof window !== 'undefined') {
        window.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
      }
      ctx = null;
      // Reset canvas to release 2D context
      canvas.width = canvas.width; // eslint-disable-line no-self-assign
    },

    // Expose for backward compat and debug overlay
    get width() { return width; },
    get height() { return height; },
    get ctx() { return ctx; },
    get canvas() { return canvas; },
  };
}
