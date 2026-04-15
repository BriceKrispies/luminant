/**
 * WebGPU renderer backend.
 *
 * Renders the game using the WebGPU API. Structurally correct and ready
 * for extension — uses instanced rendering for entities and a fullscreen
 * quad for post-processing (fog vignette).
 *
 * Architecture:
 *   - Uniforms buffer: camera transform, viewport, time
 *   - Entity instance buffer: position, radius, color, type per entity
 *   - Pipelines: clear + ground grid, entity circles, fog vignette, HUD
 *   - All rendering is batched — one draw call per entity category
 *
 * Implements the renderer interface: init, resize, render, dispose.
 */

import { TYPE, STATE } from '../engine/bindings.js';
import { ENEMY_DEFS, TYPE_TO_KEY } from '../content/enemy-types.js';
import { drawEffects } from './effects.js';
import { createCreatureResolver } from './creatures/creature-model.js';
import { drawCreaturePixel as drawCreature } from './creatures/draw-pixel.js';
import { getArchetype } from './creatures/archetypes.js';

// ── Shader source (WGSL) ──

const ENTITY_SHADER = /* wgsl */`
struct Uniforms {
  viewProj: mat4x4f,
  viewport: vec2f,
  time: f32,
  _pad: f32,
  viewOrigin: vec2f,
};

struct InstanceIn {
  @location(1) pos: vec2f,
  @location(2) radius: f32,
  @location(3) color: vec3f,
  @location(4) alpha: f32,
  @location(5) shape: f32, // 0=circle, 1=square, 2=diamond
};

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
  @location(2) alpha: f32,
  @location(3) shape: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

// Fullscreen quad vertices for each instance (triangle strip)
var<private> quadVerts: array<vec2f, 4> = array<vec2f, 4>(
  vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(1, 1),
);

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, inst: InstanceIn) -> VSOut {
  let qv = quadVerts[vi];
  let worldPos = inst.pos + qv * inst.radius * 1.5;
  let clipPos = u.viewProj * vec4f(worldPos, 0, 1);
  var out: VSOut;
  out.pos = clipPos;
  out.uv = qv;
  out.color = inst.color;
  out.alpha = inst.alpha;
  out.shape = inst.shape;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  let d = length(in.uv);

  // Circle shape
  if (in.shape < 0.5) {
    if (d > 1.0) { discard; }
    let edge = smoothstep(1.0, 0.85, d);
    let glow = smoothstep(1.5, 0.0, d) * 0.3;
    return vec4f(in.color * (edge + glow), in.alpha * edge + glow * in.alpha);
  }

  // Square shape (tanks)
  if (in.shape < 1.5) {
    let sd = max(abs(in.uv.x), abs(in.uv.y));
    if (sd > 0.85) { discard; }
    let edge = smoothstep(0.85, 0.7, sd);
    return vec4f(in.color * edge, in.alpha * edge);
  }

  // Diamond shape (pickups)
  let dd = abs(in.uv.x) + abs(in.uv.y);
  if (dd > 0.8) { discard; }
  let edge = smoothstep(0.8, 0.5, dd);
  let glow = smoothstep(1.2, 0.0, dd) * 0.4;
  return vec4f(in.color * (edge + glow), in.alpha * edge + glow * in.alpha * 0.5);
}
`;

const FOG_SHADER = /* wgsl */`
struct Uniforms {
  viewProj: mat4x4f,
  viewport: vec2f,
  time: f32,
  _pad: f32,
  viewOrigin: vec2f,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

var<private> fullscreenVerts: array<vec2f, 4> = array<vec2f, 4>(
  vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(1, 1),
);

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  var out: VSOut;
  out.pos = vec4f(fullscreenVerts[vi], 0, 1);
  out.uv = fullscreenVerts[vi] * 0.5 + 0.5;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  let center = vec2f(0.5, 0.5);
  let d = distance(in.uv, center) * 2.0;
  let fog = smoothstep(0.3, 1.4, d) * 0.85;
  return vec4f(0.02, 0.02, 0.04, fog);
}
`;

const GROUND_SHADER = /* wgsl */`
struct Uniforms {
  viewProj: mat4x4f,
  viewport: vec2f,
  time: f32,
  _pad: f32,
  viewOrigin: vec2f,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) worldPos: vec2f,
};

var<private> quadVerts: array<vec2f, 4> = array<vec2f, 4>(
  vec2f(0, 0), vec2f(1, 0), vec2f(0, 1), vec2f(1, 1),
);

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  let v = quadVerts[vi];
  var out: VSOut;
  out.pos = vec4f(v * 2.0 - 1.0, 0, 1);
  // Map fullscreen quad to world coordinates using camera view bounds
  out.worldPos = u.viewOrigin + v * u.viewport;
  return out;
}

// Simple hash for noise
fn hash(p: vec2f) -> f32 {
  let h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453);
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  // Grid lines
  let gridSize = 128.0;
  let grid = step(vec2f(0.985), fract(in.worldPos / gridSize));
  let gridLine = max(grid.x, grid.y) * 0.03;

  // Subtle noise pattern
  let cell = floor(in.worldPos / 16.0);
  let n = hash(cell) * 0.04 + 0.03;

  let base = vec3f(n + gridLine);
  return vec4f(base, 1.0);
}
`;

// Max entities we can render in one batch
const MAX_INSTANCES = 4096;
// Bytes per instance: pos(2f) + radius(1f) + color(3f) + alpha(1f) + shape(1f) = 8 floats = 32 bytes
const INSTANCE_STRIDE = 32;

export function createWebGPURenderer(canvas) {
  let device = null;
  let context = null;
  let format = null;
  let uniformBuffer = null;
  let uniformBindGroup = null;
  let entityPipeline = null;
  let fogPipeline = null;
  let groundPipeline = null;
  let instanceBuffer = null;
  let resizeHandler = null;

  // Creature/effects overlay — low-res offscreen canvas, blitted to visible overlay
  let effectsCanvas = null;   // visible overlay (display resolution)
  let effectsCtx = null;
  let creatureOffscreen = null; // low-res offscreen for pixel creatures
  let creatureOffCtx = null;
  let creatureResolver = null;
  let lastSnapshotTime = -1;
  let renderW = 0;
  let renderH = 0;

  return {
    id: 'webgpu',
    name: 'WebGPU',

    async init() {
      if (!navigator.gpu) throw new Error('WebGPU not supported');

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('No WebGPU adapter found');

      device = await adapter.requestDevice();
      context = canvas.getContext('webgpu');
      if (!context) throw new Error('Failed to get WebGPU context');

      format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: 'premultiplied' });

      // Uniform buffer: mat4(64) + viewport(8) + time(4) + pad(4) + viewOrigin(8) + pad(8) = 96 bytes
      uniformBuffer = device.createBuffer({
        size: 96,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      // Instance buffer
      instanceBuffer = device.createBuffer({
        size: MAX_INSTANCES * INSTANCE_STRIDE,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });

      const bindGroupLayout = device.createBindGroupLayout({
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        }],
      });

      uniformBindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
      });

      const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      });

      // Entity pipeline — instanced quads with alpha blending
      const entityModule = device.createShaderModule({ code: ENTITY_SHADER });
      entityPipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
          module: entityModule,
          entryPoint: 'vs_main',
          buffers: [{
            arrayStride: INSTANCE_STRIDE,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0, format: 'float32x2' },   // pos
              { shaderLocation: 2, offset: 8, format: 'float32' },     // radius
              { shaderLocation: 3, offset: 12, format: 'float32x3' },  // color
              { shaderLocation: 4, offset: 24, format: 'float32' },    // alpha
              { shaderLocation: 5, offset: 28, format: 'float32' },    // shape
            ],
          }],
        },
        fragment: {
          module: entityModule,
          entryPoint: 'fs_main',
          targets: [{
            format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          }],
        },
        primitive: { topology: 'triangle-strip', stripIndexFormat: undefined },
      });

      // Fog pipeline — fullscreen quad
      const fogModule = device.createShaderModule({ code: FOG_SHADER });
      fogPipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module: fogModule, entryPoint: 'vs_main' },
        fragment: {
          module: fogModule,
          entryPoint: 'fs_main',
          targets: [{
            format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          }],
        },
        primitive: { topology: 'triangle-strip' },
      });

      // Ground pipeline — fullscreen quad with noise + grid
      const groundModule = device.createShaderModule({ code: GROUND_SHADER });
      groundPipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module: groundModule, entryPoint: 'vs_main' },
        fragment: {
          module: groundModule,
          entryPoint: 'fs_main',
          targets: [{ format }],
        },
        primitive: { topology: 'triangle-strip' },
      });

      // HUD overlay canvas (text rendering via Canvas 2D, composited by browser)
      effectsCanvas = document.createElement('canvas');
      effectsCanvas.id = 'webgpu-effects-overlay';
      effectsCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
      canvas.parentElement.appendChild(effectsCanvas);
      effectsCtx = effectsCanvas.getContext('2d');
      creatureResolver = createCreatureResolver();

      this.resize();
      resizeHandler = () => this.resize();
      window.addEventListener('resize', resizeHandler);
    },

    /** Low-res render dimensions for camera/view calculations */
    get renderWidth() { return renderW; },
    get renderHeight() { return renderH; },

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      // Low-res offscreen for pixel creatures (matches Canvas 2D renderer)
      const RENDER_HEIGHT = 270;
      const aspect = rect.width / rect.height || 16 / 9;
      renderH = RENDER_HEIGHT;
      renderW = Math.round(renderH * aspect);

      if (typeof document !== 'undefined') {
        creatureOffscreen = document.createElement('canvas');
        creatureOffscreen.width = renderW;
        creatureOffscreen.height = renderH;
        creatureOffCtx = creatureOffscreen.getContext('2d');
        creatureOffCtx.imageSmoothingEnabled = false;
      }

      if (effectsCanvas) {
        effectsCanvas.width = rect.width * dpr;
        effectsCanvas.height = rect.height * dpr;
        effectsCtx.imageSmoothingEnabled = false;
      }
    },

    render(snapshot, camera) {
      if (!device || !context) return;

      const cw = canvas.getBoundingClientRect().width;
      const ch = canvas.getBoundingClientRect().height;
      const view = camera.getViewBounds();

      // Build orthographic view-projection matrix
      const l = view.left, r = view.right, t = view.top, b = view.bottom;
      // Column-major mat4 for orthographic projection
      const viewProj = new Float32Array([
        2 / (r - l), 0, 0, 0,
        0, 2 / (t - b), 0, 0,  // Y flipped for GPU coords
        0, 0, 1, 0,
        -(r + l) / (r - l), -(t + b) / (t - b), 0, 1,
      ]);

      // Upload uniforms
      const uniformData = new Float32Array(24); // 96 bytes
      uniformData.set(viewProj, 0);    // mat4 at offset 0
      uniformData[16] = r - l;          // viewport width (world units)
      uniformData[17] = b - t;          // viewport height
      uniformData[18] = snapshot.time || 0;
      uniformData[19] = 0;              // padding
      uniformData[20] = l;              // viewOrigin.x
      uniformData[21] = t;              // viewOrigin.y
      uniformData[22] = 0;              // padding
      uniformData[23] = 0;              // padding
      device.queue.writeBuffer(uniformBuffer, 0, uniformData);

      // Build instance data from snapshot (enemies drawn via creature overlay)
      const instanceData = new Float32Array(MAX_INSTANCES * 8);
      let count = 0;
      const margin = 50;
      const creatureEnemies = []; // enemies to draw on overlay

      const dt = snapshot.time - (lastSnapshotTime >= 0 ? lastSnapshotTime : snapshot.time);
      lastSnapshotTime = snapshot.time;

      for (const e of snapshot.entities) {
        if (e.state === STATE.FREE) continue;
        if (count >= MAX_INSTANCES) break;
        // Frustum cull
        if (e.x < view.left - margin || e.x > view.right + margin ||
            e.y < view.top - margin || e.y > view.bottom + margin) continue;

        // Creatures with archetypes go to creature overlay
        if (getArchetype(e.type)) {
          creatureEnemies.push(e);
          continue;
        }

        const off = count * 8;
        instanceData[off] = e.x;
        instanceData[off + 1] = e.y;
        instanceData[off + 2] = e.radius;

        // Color + shape by type
        let cr = 0.5, cg = 0.5, cb = 0.5;
        let alpha = 1;
        let shape = 0; // circle

        if (e.type >= 2 && e.type <= 9) {
          // Fallback for enemies without archetypes
          const key = TYPE_TO_KEY[e.type];
          const def = key ? ENEMY_DEFS[key] : null;
          if (def && def.color) {
            const parsed = parseColor(def.color);
            cr = parsed[0]; cg = parsed[1]; cb = parsed[2];
          } else {
            cr = 0.3; cg = 0.8; cb = 0.7;
          }
          if (e.type === TYPE.ENEMY_TANK) shape = 1;
          if (e.state === STATE.DYING) alpha = 0.4;
        } else if (e.type >= 10 && e.type <= 19) {
          cr = 1; cg = 1; cb = 0.5;
          if (e.type === TYPE.PROJECTILE_SPREAD) { cr = 1; cg = 0.5; cb = 0.25; }
          if (e.type === TYPE.PROJECTILE_AOE) { cr = 0.25; cg = 0.8; cb = 1; }
        } else if (e.type >= 20) {
          shape = 2; // diamond
          if (e.type === TYPE.PICKUP_XP) {
            cr = 0.25; cg = 0.65; cb = 1;
          } else {
            cr = 1; cg = 0.25; cb = 0.25;
          }
        }

        instanceData[off + 3] = cr;
        instanceData[off + 4] = cg;
        instanceData[off + 5] = cb;
        instanceData[off + 6] = alpha;
        instanceData[off + 7] = shape;
        count++;
      }

      if (count > 0) {
        device.queue.writeBuffer(instanceBuffer, 0, instanceData, 0, count * 8);
      }

      // Render
      const texture = context.getCurrentTexture();
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: texture.createView(),
          clearValue: { r: 0.04, g: 0.04, b: 0.055, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });

      // Draw ground (grid + noise)
      pass.setPipeline(groundPipeline);
      pass.setBindGroup(0, uniformBindGroup);
      pass.draw(4);

      // Draw entities (instanced)
      if (count > 0) {
        pass.setPipeline(entityPipeline);
        pass.setBindGroup(0, uniformBindGroup);
        pass.setVertexBuffer(0, instanceBuffer);
        pass.draw(4, count);
      }

      // Draw fog vignette
      pass.setPipeline(fogPipeline);
      pass.setBindGroup(0, uniformBindGroup);
      pass.draw(4);

      pass.end();
      device.queue.submit([encoder.finish()]);

      // Creatures + effects via low-res offscreen, blitted to overlay
      if (effectsCtx && creatureOffCtx) {
        const dpr = window.devicePixelRatio || 1;
        const physW = Math.round(cw * dpr);
        const physH = Math.round(ch * dpr);

        // Draw creatures to low-res offscreen canvas
        creatureOffCtx.setTransform(1, 0, 0, 1, 0, 0);
        creatureOffCtx.clearRect(0, 0, renderW, renderH);
        creatureOffCtx.imageSmoothingEnabled = false;
        creatureOffCtx.save();
        creatureOffCtx.translate(Math.round(renderW / 2), Math.round(renderH / 2));
        creatureOffCtx.scale(camera.zoom, camera.zoom);
        creatureOffCtx.translate(-Math.round(camera.x), -Math.round(camera.y));

        if (creatureResolver) {
          for (const e of creatureEnemies) {
            const model = creatureResolver.resolve(e, snapshot.time, Math.max(dt, 1 / 60));
            if (model) drawCreature(creatureOffCtx, model);
          }
        }

        drawEffects(creatureOffCtx, snapshot, camera);
        creatureOffCtx.restore();

        // Blit low-res to overlay at full resolution with nearest-neighbor
        effectsCtx.setTransform(1, 0, 0, 1, 0, 0);
        effectsCtx.clearRect(0, 0, physW, physH);
        effectsCtx.imageSmoothingEnabled = false;
        effectsCtx.drawImage(creatureOffscreen, 0, 0, physW, physH);
      }
    },

    dispose() {
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
      }
      if (effectsCanvas && effectsCanvas.parentElement) {
        effectsCanvas.parentElement.removeChild(effectsCanvas);
      }
      effectsCanvas = null;
      effectsCtx = null;
      creatureOffscreen = null;
      creatureOffCtx = null;
      if (creatureResolver) { creatureResolver.reset(); creatureResolver = null; }
      lastSnapshotTime = -1;
      if (instanceBuffer) { instanceBuffer.destroy(); instanceBuffer = null; }
      if (uniformBuffer) { uniformBuffer.destroy(); uniformBuffer = null; }
      if (device) { device.destroy(); device = null; }
      context = null;
      entityPipeline = null;
      fogPipeline = null;
      groundPipeline = null;
      uniformBindGroup = null;
      // Unconfigure WebGPU context so the canvas can be reused with a different context type
      if (context) {
        context.unconfigure();
        context = null;
      }
    },

    get width() { return canvas.width; },
    get height() { return canvas.height; },
    get canvas() { return canvas; },
  };
}

// ── Helpers ──

/** Parse CSS hex color to [r, g, b] in 0-1 range */
function parseColor(hex) {
  if (hex[0] === '#') hex = hex.slice(1);
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const n = parseInt(hex, 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

