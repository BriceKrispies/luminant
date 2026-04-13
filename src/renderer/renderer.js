/**
 * Main renderer — orchestrates layered canvas drawing.
 * Consumes snapshots from the engine; never reads or writes simulation state.
 */

import { drawGround } from './ground.js';
import { drawFog } from './fog.js';
import { drawLights } from './lights.js';
import { drawEntities } from './entities.js';
import { drawEffects } from './effects.js';
import { drawHUD } from './ui-render.js';
import { createDebugOverlay } from './debug-overlay.js';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let width = canvas.width;
  let height = canvas.height;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    width = rect.width * dpr;
    height = rect.height * dpr;
    canvas.width = width;
    canvas.height = height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resize();
  window.addEventListener('resize', resize);

  return {
    get width() { return width; },
    get height() { return height; },
    get ctx() { return ctx; },
    get canvas() { return canvas; },

    resize,

    /**
     * Render a full frame.
     * @param {object} snapshot - entity snapshot from engine
     * @param {object} camera - camera system
     * @param {object} gameState - additional game state (level, xp, etc.)
     * @param {object} debugInfo - optional debug/profiling data
     */
    render(snapshot, camera, gameState, debugInfo) {
      const cw = canvas.getBoundingClientRect().width;
      const ch = canvas.getBoundingClientRect().height;

      // Clear
      ctx.fillStyle = '#0a0a0e';
      ctx.fillRect(0, 0, cw, ch);

      ctx.save();

      // Apply camera transform
      const view = camera.getViewBounds();
      const scaleX = cw / (view.right - view.left);
      const scaleY = ch / (view.bottom - view.top);
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

    destroy() {
      window.removeEventListener('resize', resize);
    },
  };
}
