/**
 * Renderer interface contract.
 *
 * Every renderer backend (Canvas 2D, WebGPU, future backends) must implement
 * this interface. The renderer manager creates, switches, and disposes
 * renderers through these methods.
 *
 * Renderers consume snapshots and camera state — they never read or write
 * engine memory directly.
 */

/**
 * @typedef {Object} RendererBackend
 * @property {string} id — machine identifier ('canvas', 'webgpu')
 * @property {string} name — human-readable name ('Canvas 2D', 'WebGPU')
 * @property {function} init — async setup (may acquire GPU device, compile shaders, etc.)
 * @property {function} resize — handle viewport resize
 * @property {function} render — draw one frame from snapshot + camera + gameState
 * @property {function} dispose — release all resources (GPU buffers, contexts, listeners)
 */

/**
 * Validate that an object implements the renderer interface.
 * Throws if any required method/property is missing.
 */
export function validateRenderer(renderer) {
  const required = ['id', 'name', 'init', 'resize', 'render', 'dispose'];
  for (const key of required) {
    const type = typeof renderer[key];
    if (key === 'id' || key === 'name') {
      if (type !== 'string') throw new Error(`Renderer missing ${key} (string)`);
    } else {
      if (type !== 'function') throw new Error(`Renderer missing ${key}()`);
    }
  }
  return true;
}
