#!/usr/bin/env node
/**
 * Headless creature renderer — renders a creature archetype to PNG.
 *
 * Usage:
 *   node studio/render.js ghost
 *   node studio/render.js slime --size=512 --anim=locomotion --out=my_slime.png
 *   node studio/render.js --all
 *
 * Options:
 *   --size=N       Canvas size in pixels (default: 512)
 *   --anim=STATE   Animation state: idle, locomotion, attack, hit_react, dying (default: idle)
 *   --time=N       Simulation time in seconds to advance before capture (default: 0.5)
 *   --bg=COLOR     Background: transparent, dark, light (default: transparent)
 *   --out=PATH     Output file path (default: docs/characters/render_<name>.png)
 *   --all          Render all archetypes
 *   --zoom=N       Zoom multiplier (default: auto-fit)
 */

import { createCanvas } from 'canvas';
import { createStudioRig, createSyntheticEntity } from './studio-rig.js';
import { drawCreature } from '../src/renderer/creatures/draw-canvas.js';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

const ALL_ARCHETYPES = ['slime', 'ghost', 'ember', 'brute'];

// ── Parse args ──

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    archetypes: [],
    size: 512,
    anim: 'idle',
    time: 0.5,
    bg: 'transparent',
    out: null,
    zoom: null,
    all: false,
  };

  for (const arg of args) {
    if (arg === '--all') {
      opts.all = true;
    } else if (arg.startsWith('--size=')) {
      opts.size = parseInt(arg.slice(7));
    } else if (arg.startsWith('--anim=')) {
      opts.anim = arg.slice(7);
    } else if (arg.startsWith('--time=')) {
      opts.time = parseFloat(arg.slice(7));
    } else if (arg.startsWith('--bg=')) {
      opts.bg = arg.slice(5);
    } else if (arg.startsWith('--out=')) {
      opts.out = arg.slice(6);
    } else if (arg.startsWith('--zoom=')) {
      opts.zoom = parseFloat(arg.slice(7));
    } else if (!arg.startsWith('--')) {
      opts.archetypes.push(arg);
    }
  }

  if (opts.all) {
    opts.archetypes = ALL_ARCHETYPES;
  }

  if (opts.archetypes.length === 0) {
    console.error('Usage: node studio/render.js <archetype> [options]');
    console.error('  Archetypes: slime, ghost, ember, brute');
    console.error('  Or: node studio/render.js --all');
    process.exit(1);
  }

  return opts;
}

// ── Render a single creature ──

function renderCreature(archetypeId, opts) {
  const size = opts.size;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background
  if (opts.bg === 'dark') {
    ctx.fillStyle = '#0a0a0e';
    ctx.fillRect(0, 0, size, size);
  } else if (opts.bg === 'light') {
    ctx.fillStyle = '#ddd';
    ctx.fillRect(0, 0, size, size);
  }
  // transparent = do nothing

  // Build rig
  const rig = createStudioRig(archetypeId, 1);
  const entity = createSyntheticEntity(archetypeId, { radius: 14 });

  // If locomotion, give it velocity so it animates properly
  if (opts.anim === 'locomotion') {
    entity.vx = 60;
    entity.vy = 0;
  }
  if (opts.anim === 'dying') {
    entity.state = 2;
  }

  // Advance simulation to get a good pose
  const dt = 1 / 60;
  const steps = Math.round(opts.time / dt);
  let gameTime = 0;
  let pendingOneShot = null;

  const isOneShot = opts.anim === 'attack' || opts.anim === 'hit_react' || opts.anim === 'dying';
  if (isOneShot) {
    pendingOneShot = opts.anim;
  }

  for (let i = 0; i < steps; i++) {
    gameTime += dt;
    rig.resolve({
      time: gameTime,
      dt,
      entity,
      forceAnim: pendingOneShot || (i === 0 ? opts.anim : null),
      autoExpression: true,
    });
    if (pendingOneShot) pendingOneShot = null;
  }

  // Final resolve for the render frame
  gameTime += dt;
  entity.x = 0;
  entity.y = 0;
  const model = rig.resolve({
    time: gameTime,
    dt,
    entity,
    autoExpression: true,
  });

  // Find the body bone's actual world position (may be drifted by overlays/secondaries)
  // and center the canvas on it
  const bodyIdx = rig.skeleton.getBoneIndex('body');
  const bodyOff = bodyIdx * 5; // POSE_STRIDE = 5
  const bodyCenterX = model.worldPose[bodyOff + 0]; // PX
  const bodyCenterY = model.worldPose[bodyOff + 1]; // PY

  // Force model x/y to match body center for shadow/flash positioning
  model.x = bodyCenterX;
  model.y = bodyCenterY;

  // Draw centered on the body's actual position
  const radius = entity.radius;
  const zoom = opts.zoom || (size / (radius * 5));

  ctx.save();
  ctx.translate(size / 2 - bodyCenterX * zoom, size / 2 - bodyCenterY * zoom);
  ctx.scale(zoom, zoom);

  drawCreature(ctx, model);

  ctx.restore();

  // Output path
  const outPath = opts.out || `docs/characters/render_${archetypeId}.png`;
  const fullPath = resolve(outPath);
  mkdirSync(dirname(fullPath), { recursive: true });

  const buffer = canvas.toBuffer('image/png');
  writeFileSync(fullPath, buffer);

  console.log(`Rendered ${archetypeId} → ${outPath} (${size}x${size})`);
  return outPath;
}

// ── Main ──

const opts = parseArgs();

for (const id of opts.archetypes) {
  if (!ALL_ARCHETYPES.includes(id)) {
    console.error(`Unknown archetype: ${id}. Valid: ${ALL_ARCHETYPES.join(', ')}`);
    process.exit(1);
  }
  renderCreature(id, {
    ...opts,
    // Only use custom out path for single renders
    out: opts.archetypes.length === 1 ? opts.out : null,
  });
}
