/**
 * Renderer module — public API.
 *
 * Re-exports the Canvas 2D renderer for backward compatibility with
 * harnesses and tests that import createRenderer directly.
 *
 * For the main app, use renderer-manager.js instead — it handles
 * capability detection, preference, and runtime switching.
 */

export { createCanvasRenderer as createRenderer } from './canvas-renderer.js';
export { createCanvasRenderer } from './canvas-renderer.js';
export { createWebGPURenderer } from './webgpu-renderer.js';
export { createRendererManager } from './renderer-manager.js';
export { validateRenderer } from './renderer-interface.js';
