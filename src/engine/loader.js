/**
 * Loads and instantiates the core WASM engine module.
 * Works in both browser (fetch) and Node.js (fs) contexts.
 *
 * In browser, uses import.meta.env.BASE_URL so the path works
 * under any deployment base (e.g. GitHub Pages subpath).
 */

export async function loadEngine(wasmPath) {
  let buffer;

  if (typeof window !== 'undefined') {
    // Browser: use Vite's base URL for correct subpath resolution
    if (!wasmPath) {
      wasmPath = (import.meta.env?.BASE_URL || '/') + 'core.wasm';
    }
    const response = await fetch(wasmPath);
    buffer = await response.arrayBuffer();
  } else {
    // Node.js: resolve relative to this file
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const { fileURLToPath } = await import('url');
    const path = resolve(fileURLToPath(import.meta.url), '..', '..', '..', 'public', 'core.wasm');
    buffer = readFileSync(path).buffer;
  }

  const { instance } = await WebAssembly.instantiate(buffer, {});
  return instance.exports;
}
