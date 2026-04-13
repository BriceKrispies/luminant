/**
 * Tests for renderer abstraction: interface validation, selection logic,
 * preference handling, and fallback behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateRenderer } from '../src/renderer/renderer-interface.js';
import {
  detectWebGPU,
  loadPreference,
  savePreference,
  createRendererManager,
} from '../src/renderer/renderer-manager.js';

// ── Interface validation ──

describe('Renderer interface', () => {
  it('validates a complete renderer', () => {
    const renderer = {
      id: 'test',
      name: 'Test Renderer',
      init: async () => {},
      resize: () => {},
      render: () => {},
      dispose: () => {},
    };
    expect(validateRenderer(renderer)).toBe(true);
  });

  it('rejects renderer missing id', () => {
    const renderer = {
      name: 'Test',
      init: async () => {},
      resize: () => {},
      render: () => {},
      dispose: () => {},
    };
    expect(() => validateRenderer(renderer)).toThrow('id');
  });

  it('rejects renderer missing render()', () => {
    const renderer = {
      id: 'test',
      name: 'Test',
      init: async () => {},
      resize: () => {},
      dispose: () => {},
    };
    expect(() => validateRenderer(renderer)).toThrow('render');
  });

  it('rejects renderer missing dispose()', () => {
    const renderer = {
      id: 'test',
      name: 'Test',
      init: async () => {},
      resize: () => {},
      render: () => {},
    };
    expect(() => validateRenderer(renderer)).toThrow('dispose');
  });
});

// ── WebGPU detection ──

describe('WebGPU detection', () => {
  it('returns false when navigator.gpu is absent', async () => {
    // In Node/Vitest, navigator.gpu is not defined
    const result = await detectWebGPU();
    expect(result).toBe(false);
  });
});

// ── Preference persistence ──

describe('Renderer preferences', () => {
  let storage;

  beforeEach(() => {
    storage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key) => storage[key] ?? null,
      setItem: (key, val) => { storage[key] = val; },
      removeItem: (key) => { delete storage[key]; },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves and loads preference', () => {
    expect(loadPreference()).toBe(null);
    savePreference('webgpu');
    expect(loadPreference()).toBe('webgpu');
    savePreference('canvas');
    expect(loadPreference()).toBe('canvas');
  });

  it('handles localStorage errors gracefully', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    expect(loadPreference()).toBe(null);
    expect(() => savePreference('canvas')).not.toThrow();
  });
});

// ── Renderer manager (with mocked canvas) ──

describe('Renderer manager', () => {
  let canvas;

  beforeEach(() => {
    // Mock canvas with minimal 2D context
    const ctx = {
      fillRect: () => {},
      fillText: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
      rotate: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      setTransform: () => {},
      drawImage: () => {},
      createRadialGradient: () => ({
        addColorStop: () => {},
      }),
      createImageData: () => ({ data: new Uint8ClampedArray(256 * 256 * 4) }),
      putImageData: () => {},
      globalCompositeOperation: '',
      globalAlpha: 1,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: '',
    };

    canvas = {
      getContext: (type) => type === '2d' ? ctx : null,
      getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
      width: 800,
      height: 600,
      parentElement: { appendChild: () => {}, removeChild: () => {} },
    };

    // Stub localStorage
    const storage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key) => storage[key] ?? null,
      setItem: (key, val) => { storage[key] = val; },
      removeItem: (key) => { delete storage[key]; },
    });

    // Stub devicePixelRatio
    vi.stubGlobal('devicePixelRatio', 1);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializes with canvas when WebGPU unavailable', async () => {
    const manager = createRendererManager(canvas);
    await manager.init();
    expect(manager.activeId).toBe('canvas');
    expect(manager.activeName).toBe('Canvas 2D');
    expect(manager.webgpuAvailable).toBe(false);
    manager.dispose();
  });

  it('lists available renderers', async () => {
    const manager = createRendererManager(canvas);
    await manager.init();
    expect(manager.available).toContain('canvas');
    expect(manager.available).not.toContain('webgpu');
    manager.dispose();
  });

  it('calls onSwitch callback on init', async () => {
    const onSwitch = vi.fn();
    const manager = createRendererManager(canvas, { onSwitch });
    await manager.init();
    expect(onSwitch).toHaveBeenCalledWith('canvas', 'Canvas 2D');
    manager.dispose();
  });

  it('refuses to switch to webgpu when unavailable', async () => {
    const onError = vi.fn();
    const manager = createRendererManager(canvas, { onError });
    await manager.init();
    const result = await manager.switchTo('webgpu');
    expect(result).toBe(false);
    expect(onError).toHaveBeenCalledWith('webgpu', expect.stringContaining('not supported'));
    expect(manager.activeId).toBe('canvas');
    manager.dispose();
  });

  it('toggle stays on canvas when webgpu unavailable', async () => {
    const manager = createRendererManager(canvas);
    await manager.init();
    await manager.toggle();
    expect(manager.activeId).toBe('canvas');
    manager.dispose();
  });

  it('saves preference on switch', async () => {
    const manager = createRendererManager(canvas);
    await manager.init();
    // Already canvas, switching to canvas is a no-op
    await manager.switchTo('canvas');
    expect(loadPreference()).toBe('canvas');
    manager.dispose();
  });

  it('respects saved canvas preference', async () => {
    savePreference('canvas');
    const manager = createRendererManager(canvas);
    await manager.init();
    expect(manager.activeId).toBe('canvas');
    manager.dispose();
  });

  it('ignores saved webgpu preference when unavailable', async () => {
    savePreference('webgpu');
    const manager = createRendererManager(canvas);
    await manager.init();
    // Should fall back to canvas since webgpu not available
    expect(manager.activeId).toBe('canvas');
    manager.dispose();
  });

  it('render proxy works', async () => {
    const manager = createRendererManager(canvas);
    await manager.init();
    // Should not throw — just proxies to canvas renderer
    const mockSnapshot = { entities: [], player: null, time: 0 };
    const mockCamera = {
      getViewBounds: () => ({ left: 0, right: 800, top: 0, bottom: 600 }),
      zoom: 1, x: 400, y: 300,
    };
    expect(() => manager.render(mockSnapshot, mockCamera, {})).not.toThrow();
    manager.dispose();
  });

  it('resize proxy works', async () => {
    const manager = createRendererManager(canvas);
    await manager.init();
    expect(() => manager.resize()).not.toThrow();
    manager.dispose();
  });
});
