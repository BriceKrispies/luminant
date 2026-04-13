/**
 * Camera / viewport system.
 * Follows the player with smooth interpolation.
 */

import { smoothApproach, clamp } from '../utils/math.js';

export function createCameraSystem(canvasW, canvasH, worldW, worldH) {
  let x = worldW / 2;
  let y = worldH / 2;
  let zoom = 1;
  let targetX = x;
  let targetY = y;
  let followSpeed = 18;
  let shake = 0;
  let shakeDecay = 8;
  let impulseX = 0;
  let impulseY = 0;
  let impulseDecay = 12;

  return {
    get x() { return x; },
    get y() { return y; },
    get zoom() { return zoom; },
    set zoom(v) { zoom = v; },

    setTarget(tx, ty) {
      targetX = tx;
      targetY = ty;
    },

    addShake(intensity) {
      shake = Math.min(shake + intensity, 20);
    },

    addImpulse(fromX, fromY, strength) {
      const dx = x - fromX;
      const dy = y - fromY;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      impulseX += (dx / len) * strength;
      impulseY += (dy / len) * strength;
    },

    update(dt) {
      x = smoothApproach(x, targetX, followSpeed, dt);
      y = smoothApproach(y, targetY, followSpeed, dt);

      if (shake > 0.1) {
        shake *= Math.exp(-shakeDecay * dt);
      } else {
        shake = 0;
      }

      // Decay impulse
      if (Math.abs(impulseX) > 0.01 || Math.abs(impulseY) > 0.01) {
        const decay = Math.exp(-impulseDecay * dt);
        impulseX *= decay;
        impulseY *= decay;
      } else {
        impulseX = 0;
        impulseY = 0;
      }
    },

    /** Convert world coords to screen coords */
    worldToScreen(wx, wy) {
      const sx = (wx - x) * zoom + canvasW / 2;
      const sy = (wy - y) * zoom + canvasH / 2;
      const ox = (shake > 0.1 ? (Math.random() - 0.5) * shake : 0) + impulseX;
      const oy = (shake > 0.1 ? (Math.random() - 0.5) * shake : 0) + impulseY;
      return { x: sx + ox, y: sy + oy };
    },

    /** Convert screen coords to world coords */
    screenToWorld(sx, sy) {
      return {
        x: (sx - canvasW / 2) / zoom + x,
        y: (sy - canvasH / 2) / zoom + y,
      };
    },

    /** Get visible world bounds */
    getViewBounds() {
      const hw = (canvasW / 2) / zoom;
      const hh = (canvasH / 2) / zoom;
      return {
        left: x - hw,
        right: x + hw,
        top: y - hh,
        bottom: y + hh,
      };
    },

    resize(w, h) {
      canvasW = w;
      canvasH = h;
    },
  };
}
