/**
 * Creature Studio — interactive dev tool for creature art iteration.
 *
 * Renders creatures at large scale with full control over animation,
 * expression, and debug overlays. Changes to creature modules
 * propagate via Vite HMR.
 */

import { drawCreaturePixel as drawCreature } from '../src/renderer/creatures/draw-pixel.js';
import { POSE_STRIDE, PX, PY, PROT, PSX, PSY } from '../src/renderer/creatures/skeleton.js';
import { ARCHETYPES } from '../src/renderer/creatures/archetypes.js';
import { createStudioRig, createSyntheticEntity } from './studio-rig.js';

// ── State ──

const state = {
  archetypeId: 'slime',
  animState: 'idle',
  expression: 'neutral',
  autoExpression: true,
  loopOneShot: true,
  playing: true,
  speed: 1.0,
  scrub: 0,
  radius: 14,
  hpFraction: 1.0,
  facing: 0,
  zoom: 5,
  bg: 'dark',
  pupilX: 0,
  pupilY: 0,
  showBones: false,
  showNames: false,
  showSlots: false,
  showGrid: false,
  showAll: false,
};

let rig = null;
let entity = null;
let gameTime = 0;
let lastFrameTime = 0;
let pendingOneShot = null;
let oneShotPlaying = false;

// All-mode rigs
let allRigs = {};
const ALL_ARCHETYPES = Object.keys(ARCHETYPES);

// ── Canvas ──

const canvas = document.getElementById('creature-canvas');
const ctx = canvas.getContext('2d');
const infoEl = document.getElementById('canvas-info');

function resizeCanvas() {
  const area = document.getElementById('canvas-area');
  const size = Math.min(area.clientWidth, area.clientHeight);
  canvas.width = size * devicePixelRatio;
  canvas.height = size * devicePixelRatio;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ── Rig management ──

function rebuildRig() {
  rig = createStudioRig(state.archetypeId, 1);
  entity = createSyntheticEntity(state.archetypeId, { radius: state.radius });
  updateEntity();
  applyAnimState();
}

function rebuildAllRigs() {
  allRigs = {};
  for (const id of ALL_ARCHETYPES) {
    allRigs[id] = createStudioRig(id, ALL_ARCHETYPES.indexOf(id) + 10);
  }
}

function updateEntity() {
  if (!entity) return;
  entity.radius = state.radius;
  entity.hp = Math.round(entity.maxHp * state.hpFraction);
  entity.facing = state.facing;

  // Simulate velocity for locomotion
  if (state.animState === 'locomotion') {
    entity.vx = Math.cos(state.facing) * 60;
    entity.vy = Math.sin(state.facing) * 60;
  } else {
    entity.vx = 0;
    entity.vy = 0;
  }

  // Dying state
  entity.state = state.animState === 'dying' ? 2 : 1;
}

function applyAnimState() {
  if (!rig) return;
  const isOneShot = state.animState === 'attack' || state.animState === 'hit_react' || state.animState === 'dying';

  if (isOneShot) {
    rig.reset();
    updateEntity();
    pendingOneShot = state.animState;
    oneShotPlaying = true;
  } else {
    pendingOneShot = null;
    oneShotPlaying = false;
  }
}

// Populate archetype buttons from ARCHETYPES
{
  const container = document.getElementById('archetype-btns');
  for (const id of ALL_ARCHETYPES) {
    const btn = document.createElement('button');
    btn.className = 'btn' + (id === state.archetypeId ? ' active' : '');
    btn.dataset.id = id;
    btn.textContent = ARCHETYPES[id].name;
    container.appendChild(btn);
  }
}

rebuildRig();

// ── Render loop ──

function render(now) {
  requestAnimationFrame(render);

  const dt = lastFrameTime ? Math.min((now - lastFrameTime) / 1000, 0.1) : 1 / 60;
  lastFrameTime = now;

  const scaledDt = state.playing ? dt * state.speed : 0;
  if (state.playing) gameTime += scaledDt;

  updateEntity();

  // Check if one-shot finished and should loop
  if (oneShotPlaying && state.loopOneShot && state.playing) {
    const ctrl = rig.animController;
    const isOneShot = state.animState === 'attack' || state.animState === 'hit_react' || state.animState === 'dying';
    if (isOneShot && ctrl.state !== state.animState && !pendingOneShot) {
      // One-shot returned to base — replay it
      rig.reset();
      pendingOneShot = state.animState;
    }
  }

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Background
  drawBackground(w, h);

  if (state.showAll) {
    renderAllArchetypes(w, h, scaledDt);
  } else {
    renderSingle(w, h, scaledDt);
  }

  // Info
  const ctrl = rig.animController;
  infoEl.textContent = `${state.archetypeId} | state: ${ctrl.state} | time: ${gameTime.toFixed(2)}s | bones: ${rig.skeleton.boneCount}`;
}

function renderSingle(w, h, dt) {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(state.zoom * devicePixelRatio, state.zoom * devicePixelRatio);

  const model = rig.resolve({
    time: gameTime,
    dt: dt,
    entity,
    forceAnim: pendingOneShot,
    forceExpression: state.autoExpression ? null : state.expression,
    autoExpression: state.autoExpression,
    pupilX: state.pupilX,
    pupilY: state.pupilY,
    paused: !state.playing,
    scrubTime: !state.playing ? state.scrub : null,
  });

  if (pendingOneShot) pendingOneShot = null;

  drawCreature(ctx, model);

  // Debug overlays
  if (state.showGrid) drawGrid(ctx);
  if (state.showBones) drawBoneOverlay(ctx, model);
  if (state.showSlots) drawSlotOverlay(ctx, model);

  ctx.restore();
}

function renderAllArchetypes(w, h, dt) {
  if (Object.keys(allRigs).length === 0) rebuildAllRigs();

  const count = ALL_ARCHETYPES.length;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const cellW = w / cols;
  const cellH = h / rows;
  const zoom = Math.min(cellW, cellH) / (state.radius * 12) * devicePixelRatio;

  for (let i = 0; i < ALL_ARCHETYPES.length; i++) {
    const id = ALL_ARCHETYPES[i];
    const r = allRigs[id];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = cellW * col + cellW / 2;
    const cy = cellH * row + cellH / 2;

    const ent = createSyntheticEntity(id, { id: i + 10, radius: state.radius });
    if (state.animState === 'locomotion') {
      ent.vx = 60; ent.vy = 0;
    }
    if (state.animState === 'dying') ent.state = 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);

    const model = r.resolve({
      time: gameTime,
      dt,
      entity: ent,
      forceAnim: pendingOneShot,
      autoExpression: true,
      paused: !state.playing,
      scrubTime: !state.playing ? state.scrub : null,
    });

    drawCreature(ctx, model);

    ctx.restore();

    // Label
    ctx.fillStyle = '#666';
    ctx.font = `${12 * devicePixelRatio}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(id, cx, cy + cellH / 2 - 10 * devicePixelRatio);
  }

  if (pendingOneShot) pendingOneShot = null;
}

function drawBackground(w, h) {
  if (state.bg === 'dark') {
    ctx.fillStyle = '#0a0a0e';
    ctx.fillRect(0, 0, w, h);
  } else if (state.bg === 'light') {
    ctx.fillStyle = '#ddd';
    ctx.fillRect(0, 0, w, h);
  } else if (state.bg === 'checker') {
    ctx.fillStyle = '#1a1a1e';
    ctx.fillRect(0, 0, w, h);
    const s = 20 * devicePixelRatio;
    ctx.fillStyle = '#222228';
    for (let y = 0; y < h; y += s * 2) {
      for (let x = 0; x < w; x += s * 2) {
        ctx.fillRect(x, y, s, s);
        ctx.fillRect(x + s, y + s, s, s);
      }
    }
  } else if (state.bg === 'game') {
    // Dark ground with subtle gradient
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, '#1a1520');
    grad.addColorStop(1, '#0a0810');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawGrid(ctx) {
  ctx.strokeStyle = 'rgba(80, 80, 100, 0.3)';
  ctx.lineWidth = 0.5;
  for (let i = -5; i <= 5; i++) {
    const p = i * 10;
    ctx.beginPath();
    ctx.moveTo(p, -50);
    ctx.lineTo(p, 50);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-50, p);
    ctx.lineTo(50, p);
    ctx.stroke();
  }
  // Axes
  ctx.strokeStyle = 'rgba(200, 60, 60, 0.5)';
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(-50, 0); ctx.lineTo(50, 0); ctx.stroke();
  ctx.strokeStyle = 'rgba(60, 200, 60, 0.5)';
  ctx.beginPath(); ctx.moveTo(0, -50); ctx.lineTo(0, 50); ctx.stroke();
}

function drawBoneOverlay(ctx, model) {
  const { skeleton, worldPose } = model;
  const zoom = state.zoom;

  for (let i = 0; i < skeleton.boneCount; i++) {
    const bone = skeleton.bones[i];
    const off = i * POSE_STRIDE;
    const bx = worldPose[off + PX];
    const by = worldPose[off + PY];

    // Line to parent
    if (bone.parentIndex !== -1) {
      const poff = bone.parentIndex * POSE_STRIDE;
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.5)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(worldPose[poff + PX], worldPose[poff + PY]);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    // Bone dot
    const isAnchor = bone.tags.includes('anchor');
    const isFace = bone.tags.includes('face');
    const isAccent = bone.tags.includes('accent');
    ctx.fillStyle = isAnchor ? 'rgba(150,150,150,0.8)' :
                    isFace ? 'rgba(255,220,60,0.8)' :
                    isAccent ? 'rgba(180,80,255,0.8)' :
                    'rgba(80,180,255,0.8)';
    ctx.beginPath();
    ctx.arc(bx, by, 1, 0, Math.PI * 2);
    ctx.fill();

    // Name label
    if (state.showNames) {
      ctx.fillStyle = 'rgba(200,200,200,0.7)';
      ctx.font = `${1.5}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(bone.name, bx + 1.5, by - 1);
    }
  }
}

function drawSlotOverlay(ctx, model) {
  const { resolvedSlots, worldPose } = model;

  for (const slot of resolvedSlots) {
    if (slot.boneIndex === -1) continue;
    const off = slot.boneIndex * POSE_STRIDE;
    const bx = worldPose[off + PX];
    const by = worldPose[off + PY];

    ctx.fillStyle = 'rgba(255,150,50,0.7)';
    ctx.font = `${1.2}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`${slot.name}`, bx, by + 2.5);
  }
}

requestAnimationFrame(render);

// ── UI Wiring ──

function wireButtonGroup(containerId, stateKey, callback) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn) return;
    const id = btn.dataset.id;
    state[stateKey] = id;
    container.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (callback) callback(id);
  });
}

function wireSlider(sliderId, valueId, stateKey, formatter, callback) {
  const slider = document.getElementById(sliderId);
  const valueEl = document.getElementById(valueId);
  if (!slider) return;
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    state[stateKey] = v;
    if (valueEl) valueEl.textContent = formatter ? formatter(v) : v;
    if (callback) callback(v);
  });
}

function wireCheckbox(checkboxId, stateKey, callback) {
  const cb = document.getElementById(checkboxId);
  if (!cb) return;
  cb.checked = state[stateKey];
  cb.addEventListener('change', () => {
    state[stateKey] = cb.checked;
    if (callback) callback(cb.checked);
  });
}

// Archetype selector
wireButtonGroup('archetype-btns', 'archetypeId', () => {
  rebuildRig();
  gameTime = 0;
});

// Animation state
wireButtonGroup('anim-btns', 'animState', () => {
  applyAnimState();
});

// Expression
wireButtonGroup('expr-btns', 'expression', () => {
  state.autoExpression = false;
  document.getElementById('auto-expression').checked = false;
});

// Background
wireButtonGroup('bg-btns', 'bg');

// Playback buttons
document.getElementById('play-btn').addEventListener('click', () => {
  state.playing = true;
  document.getElementById('play-btn').classList.add('active');
  document.getElementById('pause-btn').classList.remove('active');
  document.getElementById('scrub-slider').disabled = true;
});

document.getElementById('pause-btn').addEventListener('click', () => {
  state.playing = false;
  document.getElementById('pause-btn').classList.add('active');
  document.getElementById('play-btn').classList.remove('active');
  document.getElementById('scrub-slider').disabled = false;
});

document.getElementById('replay-btn').addEventListener('click', () => {
  rig.reset();
  gameTime = 0;
  state.playing = true;
  document.getElementById('play-btn').classList.add('active');
  document.getElementById('pause-btn').classList.remove('active');
  document.getElementById('scrub-slider').disabled = true;
  applyAnimState();
});

// Sliders
wireSlider('speed-slider', 'speed-val', 'speed', v => v.toFixed(1) + 'x');
wireSlider('scrub-slider', 'scrub-val', 'scrub', v => Math.round(v * 100) + '%');
wireSlider('radius-slider', 'radius-val', 'radius', v => v);
wireSlider('hp-slider', 'hp-val', 'hpFraction', v => Math.round(v * 100) + '%');
wireSlider('facing-slider', 'facing-val', 'facing', v => v.toFixed(2));
wireSlider('zoom-slider', 'zoom-val', 'zoom', v => v + 'x');
wireSlider('pupil-x', 'pupil-x-val', 'pupilX', v => v.toFixed(2));
wireSlider('pupil-y', 'pupil-y-val', 'pupilY', v => v.toFixed(2));

// Checkboxes
wireCheckbox('loop-oneshot', 'loopOneShot');
wireCheckbox('auto-expression', 'autoExpression');
wireCheckbox('show-bones', 'showBones');
wireCheckbox('show-names', 'showNames');
wireCheckbox('show-slots', 'showSlots');
wireCheckbox('show-grid', 'showGrid');
wireCheckbox('show-all', 'showAll', (v) => {
  if (v) rebuildAllRigs();
});

// ── HMR ──

if (import.meta.hot) {
  import.meta.hot.accept([
    '../src/renderer/creatures/draw-pixel.js',
    '../src/renderer/creatures/rig-data.js',
    '../src/renderer/creatures/archetypes.js',
    '../src/renderer/creatures/skeleton.js',
    '../src/renderer/creatures/overlays.js',
    '../src/renderer/creatures/secondaries.js',
    '../src/renderer/creatures/expression.js',
    '../src/renderer/creatures/deformations.js',
  ], () => {
    console.log('[studio] Hot reload — rebuilding rig');
    rebuildRig();
    if (state.showAll) rebuildAllRigs();
  });
}
