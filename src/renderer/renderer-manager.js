/**
 * Renderer manager — orchestrates renderer lifecycle.
 *
 * Responsibilities:
 *   - WebGPU capability detection
 *   - Preference loading/saving (localStorage)
 *   - Current renderer creation, init, and disposal
 *   - Runtime switching between backends
 *   - Status reporting (active backend, available backends)
 *
 * The manager is the single point of contact for main.js.
 * It never touches game state or simulation — only rendering lifecycle.
 */

import { validateRenderer } from './renderer-interface.js';
import { createCanvasRenderer } from './canvas-renderer.js';
import { createWebGPURenderer } from './webgpu-renderer.js';

const STORAGE_KEY = 'luminant-renderer';

/**
 * Detect WebGPU support.
 * Returns true only if the full pipeline is available (GPU + adapter).
 */
export async function detectWebGPU() {
  if (typeof navigator === 'undefined' || !navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

/** Load saved renderer preference from localStorage */
export function loadPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Save renderer preference to localStorage */
export function savePreference(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // localStorage unavailable (private browsing, etc.)
  }
}

/**
 * Create the renderer manager.
 * Call init() to detect capabilities and start the initial renderer.
 *
 * @param {HTMLCanvasElement} canvas — the game canvas element
 * @param {Object} [options]
 * @param {function} [options.onSwitch] — called after a renderer switch with (newId, name)
 * @param {function} [options.onError] — called when a renderer fails to init
 */
export function createRendererManager(canvas, options = {}) {
  let active = null;       // current RendererBackend
  let currentCanvas = canvas;
  let webgpuAvailable = false;
  const { onSwitch, onError } = options;

  /**
   * Replace the canvas element to allow switching context types.
   * A canvas can only have one context type (2d or webgpu) for its lifetime.
   */
  function replaceCanvas() {
    const newCanvas = document.createElement('canvas');
    newCanvas.id = currentCanvas.id;
    newCanvas.className = currentCanvas.className;
    newCanvas.style.cssText = currentCanvas.style.cssText;
    newCanvas.width = currentCanvas.width;
    newCanvas.height = currentCanvas.height;
    currentCanvas.parentElement.replaceChild(newCanvas, currentCanvas);
    currentCanvas = newCanvas;
  }

  return {
    /** The current canvas element (may change on renderer switch) */
    get canvas() { return currentCanvas; },

    /** True if WebGPU is available on this device */
    get webgpuAvailable() { return webgpuAvailable; },

    /** ID of the active renderer ('canvas' or 'webgpu') */
    get activeId() { return active ? active.id : null; },

    /** Human-readable name of the active renderer */
    get activeName() { return active ? active.name : 'none'; },

    /** The active renderer backend (for direct access if needed) */
    get renderer() { return active; },

    /** List of available renderer IDs */
    get available() {
      const list = ['canvas'];
      if (webgpuAvailable) list.unshift('webgpu');
      return list;
    },

    /**
     * Initialize: detect capabilities and start the preferred renderer.
     * Selection order:
     *   1. Saved preference (if the backend is available)
     *   2. WebGPU (if available)
     *   3. Canvas 2D (always available)
     */
    async init() {
      webgpuAvailable = await detectWebGPU();
      console.log(`[renderer] WebGPU available: ${webgpuAvailable}`);

      const pref = loadPreference();
      let targetId;

      if (pref && (pref === 'canvas' || (pref === 'webgpu' && webgpuAvailable))) {
        targetId = pref;
        console.log(`[renderer] Using saved preference: ${targetId}`);
      } else if (webgpuAvailable) {
        targetId = 'webgpu';
        console.log(`[renderer] Defaulting to WebGPU`);
      } else {
        targetId = 'canvas';
        console.log(`[renderer] Defaulting to Canvas 2D`);
      }

      await this._startRenderer(targetId);
    },

    /**
     * Switch to a different renderer at runtime.
     * Disposes the old renderer cleanly and initializes the new one.
     * Returns false if the requested backend is unavailable.
     */
    async switchTo(id) {
      if (id === (active && active.id)) {
        savePreference(id);
        return true;
      }

      if (id === 'webgpu' && !webgpuAvailable) {
        console.warn(`[renderer] WebGPU not available on this browser`);
        if (onError) onError('webgpu', 'WebGPU is not supported in this browser');
        return false;
      }

      const prevId = active?.id || 'none';
      console.log(`[renderer] Switching from ${prevId} to ${id}`);

      // Dispose old
      if (active) {
        try {
          active.dispose();
          console.log(`[renderer] Disposed ${active.id}`);
        } catch (e) {
          console.warn(`[renderer] Error disposing ${active.id}:`, e);
        }
        active = null;
      }

      // Replace canvas element — a canvas can only have one context type
      replaceCanvas();

      // Start new
      const success = await this._startRenderer(id);
      if (success) {
        savePreference(id);
      }
      return success;
    },

    /**
     * Toggle between available renderers.
     * Cycles: canvas → webgpu → canvas → ...
     */
    async toggle() {
      const next = active?.id === 'canvas' && webgpuAvailable ? 'webgpu' : 'canvas';
      return this.switchTo(next);
    },

    /** Proxy: resize the active renderer */
    resize() {
      if (active) active.resize();
    },

    /** Proxy: render a frame through the active renderer */
    render(snapshot, camera, gameState) {
      if (active) active.render(snapshot, camera, gameState);
    },

    /** Dispose the active renderer and clean up */
    dispose() {
      if (active) {
        active.dispose();
        active = null;
      }
    },

    /** @private Start a renderer by ID, with fallback to canvas */
    async _startRenderer(id) {
      const renderer = id === 'webgpu'
        ? createWebGPURenderer(currentCanvas)
        : createCanvasRenderer(currentCanvas);

      try {
        validateRenderer(renderer);
        await renderer.init();
        active = renderer;
        console.log(`[renderer] Started: ${renderer.name} (${renderer.id})`);
        if (onSwitch) onSwitch(renderer.id, renderer.name);
        return true;
      } catch (e) {
        console.warn(`[renderer] Failed to start ${id}:`, e.message);
        if (onError) onError(id, e.message);

        // Fallback to canvas if WebGPU failed
        if (id !== 'canvas') {
          console.log(`[renderer] Falling back to Canvas 2D`);
          return this._startRenderer('canvas');
        }
        return false;
      }
    },
  };
}
