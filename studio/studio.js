/**
 * Creature Studio — interactive dev tool for creature art iteration.
 *
 * State is a plain object. Web components emit `studio-change` events
 * with `{ name, value }` — a single delegated listener writes state
 * and runs side-effects. The render loop reads state each frame.
 */

import './components.js';
import { drawCreaturePixel as drawCreature } from '../src/renderer/creatures/draw-pixel.js';
import { POSE_STRIDE, PX, PY } from '../src/renderer/creatures/skeleton.js';
import { ARCHETYPES } from '../src/renderer/creatures/archetypes.js';
import { createStudioRig, createSyntheticEntity } from './studio-rig.js';
import { formatProgressionDebug } from '../src/renderer/creatures/progression.js';

// ── Helpers ──

const $ = (sel) => document.querySelector(sel);
const ALL_ARCHETYPES = Object.keys(ARCHETYPES);

// ── State ──

const state = {
  archetypeId:    'slime',
  animState:      'idle',
  expression:     'neutral',
  autoExpression: true,
  loopOneShot:    true,
  playing:        true,
  speed:          1.0,
  scrub:          0,
  radius:         14,
  hpFraction:     1.0,
  facing:         0,
  zoom:           5,
  bg:             'dark',
  pupilX:         0,
  pupilY:         0,
  showBones:      false,
  showNames:      false,
  showSlots:      false,
  showGrid:       false,
  showAll:        false,
  boneVisibility: {},
  progEnabled:    true,
  level:          1,
  xpProgress:     0,
  entitySeed:     0.5,
  progGlow:       true,
  progTendrils:   true,
  progHalo:       true,
  progBurst:      true,
  triggerBurst:   false,
};

// ── DOM refs (stable, semantic) ──

const canvas       = $('#canvas');
const ctx          = canvas.getContext('2d');
const viewportInfo = $('#viewport-info');
const viewportZoom = $('#viewport-zoom');
const boneList     = $('studio-bone-list');
const scrubSlider  = $('studio-slider[name="scrub"]');
const zoomSlider   = $('studio-slider[name="zoom"]');

// ── Rig state ──

let rig            = null;
let entity         = null;
let gameTime       = 0;
let lastFrameTime  = 0;
let pendingOneShot = null;
let oneShotPlaying = false;
let allRigs        = {};
let zoomBadgeTimer = 0;

// ── Init: populate dynamic archetype selector ──

$('studio-select[name="archetypeId"]').setOptions(
  ALL_ARCHETYPES.map(id => ({ value: id, label: ARCHETYPES[id].name })),
  state.archetypeId,
);

// ── Canvas sizing ──

function resizeCanvas() {
  const area = $('#viewport');
  const size = Math.min(area.clientWidth, area.clientHeight);
  canvas.width  = size * devicePixelRatio;
  canvas.height = size * devicePixelRatio;
  canvas.style.width  = size + 'px';
  canvas.style.height = size + 'px';
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ── Mouse-wheel zoom ──

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const step = -Math.sign(e.deltaY) * 0.5;
  const clamped = Math.round(
    Math.max(1, Math.min(20, state.zoom + step)) * 2
  ) / 2;
  if (clamped !== state.zoom) {
    state.zoom = clamped;
    zoomSlider.value = clamped;
    viewportZoom.textContent = clamped + 'x';
    viewportZoom.classList.add('visible');
    zoomBadgeTimer = 1.2;
  }
}, { passive: false });

// ── Rig management ──

function rebuildRig() {
  rig    = createStudioRig(state.archetypeId, 1);
  entity = createSyntheticEntity(state.archetypeId, { radius: state.radius });
  syncEntity();
  applyAnimState();
  boneList.setBones(rig.skeleton.bones);
}

function rebuildAllRigs() {
  allRigs = {};
  for (let i = 0; i < ALL_ARCHETYPES.length; i++) {
    allRigs[ALL_ARCHETYPES[i]] = createStudioRig(ALL_ARCHETYPES[i], i + 10);
  }
}

function syncEntity() {
  if (!entity) return;
  entity.radius = state.radius;
  entity.hp     = Math.round(entity.maxHp * state.hpFraction);
  entity.facing = state.facing;
  if (state.animState === 'locomotion') {
    entity.vx = Math.cos(state.facing) * 60;
    entity.vy = Math.sin(state.facing) * 60;
  } else {
    entity.vx = 0;
    entity.vy = 0;
  }
  entity.state = state.animState === 'dying' ? 2 : 1;
}

function applyAnimState() {
  if (!rig) return;
  const oneShot = state.animState === 'attack'
               || state.animState === 'hit_react'
               || state.animState === 'dying';
  if (oneShot) {
    rig.reset();
    syncEntity();
    pendingOneShot = state.animState;
    oneShotPlaying = true;
  } else {
    pendingOneShot = null;
    oneShotPlaying = false;
  }
}

function setPlayingState(playing) {
  state.playing = playing;
  scrubSlider.disabled = playing;
  for (const btn of document.querySelectorAll('#playback-actions .action-btn')) {
    const a = btn.dataset.action;
    if (a === 'play')  btn.setAttribute('aria-pressed', playing);
    if (a === 'pause') btn.setAttribute('aria-pressed', !playing);
  }
}

rebuildRig();

// ── Event handling: single delegated listener ──

const SIDE_EFFECTS = {
  archetypeId:  () => { rebuildRig(); gameTime = 0; },
  animState:    () => applyAnimState(),
  expression:   () => {
    state.autoExpression = false;
    $('studio-toggle[name="autoExpression"]').checked = false;
  },
  showBones:    (v) => { boneList.hidden = !v; },
  showAll:      (v) => { if (v) rebuildAllRigs(); },
};

document.addEventListener('studio-change', (e) => {
  const { name, value } = e.detail;
  state[name] = value;
  const effect = SIDE_EFFECTS[name];
  if (effect) effect(value);
});

// Action buttons (play/pause/replay/burst — not state selectors)
$('#inspector').addEventListener('click', (e) => {
  const action = e.target.dataset?.action;
  if (!action) return;
  switch (action) {
    case 'play':
      setPlayingState(true);
      break;
    case 'pause':
      setPlayingState(false);
      break;
    case 'replay':
      rig.reset();
      gameTime = 0;
      setPlayingState(true);
      applyAnimState();
      break;
    case 'burst':
      state.triggerBurst = true;
      break;
  }
});

// ── Render loop ──

function render(now) {
  requestAnimationFrame(render);
  const dt = lastFrameTime
    ? Math.min((now - lastFrameTime) / 1000, 0.1)
    : 1 / 60;
  lastFrameTime = now;

  const scaledDt = state.playing ? dt * state.speed : 0;
  if (state.playing) gameTime += scaledDt;

  // Zoom badge fade
  if (zoomBadgeTimer > 0) {
    zoomBadgeTimer -= dt;
    if (zoomBadgeTimer <= 0) viewportZoom.classList.remove('visible');
  }

  syncEntity();

  // Re-trigger looping one-shots
  if (oneShotPlaying && state.loopOneShot && state.playing) {
    const oneShot = state.animState === 'attack'
                 || state.animState === 'hit_react'
                 || state.animState === 'dying';
    if (oneShot && rig.animController.state !== state.animState && !pendingOneShot) {
      rig.reset();
      pendingOneShot = state.animState;
    }
  }

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  drawBackground(w, h);

  if (state.showAll) {
    renderAllArchetypes(w, h, scaledDt);
  } else {
    renderSingle(w, h, scaledDt);
  }

  // Status bar
  viewportInfo.textContent =
    `${state.archetypeId} | state: ${rig.animController.state}` +
    ` | time: ${gameTime.toFixed(2)}s | bones: ${rig.skeleton.boneCount}` +
    ` | level: ${state.level}`;

  // Progression debug
  const progOut = $('#prog-output');
  if (progOut && !state.showAll) {
    const m = rig._lastModel;
    if (m?.progression) progOut.textContent = formatProgressionDebug(m.progression);
    else if (!state.progEnabled) progOut.textContent = 'Progression disabled';
  }
}

function renderSingle(w, h, dt) {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(state.zoom * devicePixelRatio, state.zoom * devicePixelRatio);

  const model = rig.resolve({
    time: gameTime,
    dt,
    entity,
    forceAnim:      pendingOneShot,
    forceExpression: state.autoExpression ? null : state.expression,
    autoExpression:  state.autoExpression,
    pupilX:          state.pupilX,
    pupilY:          state.pupilY,
    paused:          !state.playing,
    scrubTime:       !state.playing ? state.scrub : null,
    level:           state.level,
    xpProgress:      state.xpProgress,
    entitySeed:      state.entitySeed,
    progressionEnabled: state.progEnabled,
    progressionToggles: {
      glow:     state.progGlow,
      tendrils: state.progTendrils,
      halo:     state.progHalo,
      burst:    state.progBurst,
    },
    triggerBurst: state.triggerBurst,
  });
  state.triggerBurst = false;
  if (pendingOneShot) pendingOneShot = null;

  drawCreature(ctx, model);
  if (state.showGrid)  drawGrid(ctx);
  if (state.showBones) drawBoneOverlay(ctx, model);
  if (state.showSlots) drawSlotOverlay(ctx, model);
  ctx.restore();
}

function renderAllArchetypes(w, h, dt) {
  if (Object.keys(allRigs).length === 0) rebuildAllRigs();

  const count = ALL_ARCHETYPES.length;
  const cols  = Math.ceil(Math.sqrt(count));
  const rows  = Math.ceil(count / cols);
  const cellW = w / cols;
  const cellH = h / rows;
  const zoom  = Math.min(cellW, cellH) / (state.radius * 12) * devicePixelRatio;

  for (let i = 0; i < count; i++) {
    const id  = ALL_ARCHETYPES[i];
    const r   = allRigs[id];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx  = cellW * col + cellW / 2;
    const cy  = cellH * row + cellH / 2;

    const ent = createSyntheticEntity(id, { id: i + 10, radius: state.radius });
    if (state.animState === 'locomotion') { ent.vx = 60; ent.vy = 0; }
    if (state.animState === 'dying') ent.state = 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);
    const model = r.resolve({
      time: gameTime, dt, entity: ent,
      forceAnim:    pendingOneShot,
      autoExpression: true,
      paused:       !state.playing,
      scrubTime:    !state.playing ? state.scrub : null,
      level:        state.level,
      xpProgress:   state.xpProgress,
      entitySeed:   (i * 0.17) % 1,
      progressionEnabled: state.progEnabled,
      progressionToggles: {
        glow: state.progGlow, tendrils: state.progTendrils,
        halo: state.progHalo, burst:    state.progBurst,
      },
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

// ── Drawing helpers ──

function drawBackground(w, h) {
  switch (state.bg) {
    case 'dark':
      ctx.fillStyle = '#0a0a0e';
      ctx.fillRect(0, 0, w, h);
      break;
    case 'light':
      ctx.fillStyle = '#ddd';
      ctx.fillRect(0, 0, w, h);
      break;
    case 'checker': {
      ctx.fillStyle = '#1a1a1e';
      ctx.fillRect(0, 0, w, h);
      const s = 20 * devicePixelRatio;
      ctx.fillStyle = '#222228';
      for (let y = 0; y < h; y += s * 2)
        for (let x = 0; x < w; x += s * 2) {
          ctx.fillRect(x, y, s, s);
          ctx.fillRect(x + s, y + s, s, s);
        }
      break;
    }
    case 'game': {
      const g = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w/2);
      g.addColorStop(0, '#1a1520');
      g.addColorStop(1, '#0a0810');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      break;
    }
  }
}

function drawGrid(ctx) {
  ctx.strokeStyle = 'rgba(80,80,100,0.3)';
  ctx.lineWidth = 0.5;
  for (let i = -5; i <= 5; i++) {
    const p = i * 10;
    ctx.beginPath(); ctx.moveTo(p, -50); ctx.lineTo(p, 50);  ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-50, p); ctx.lineTo(50, p);   ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(200,60,60,0.5)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(-50, 0); ctx.lineTo(50, 0); ctx.stroke();
  ctx.strokeStyle = 'rgba(60,200,60,0.5)';
  ctx.beginPath(); ctx.moveTo(0, -50); ctx.lineTo(0, 50); ctx.stroke();
}

function drawBoneOverlay(ctx, model) {
  const { skeleton, worldPose } = model;
  const vis = state.boneVisibility;

  for (let i = 0; i < skeleton.boneCount; i++) {
    const bone = skeleton.bones[i];
    if (vis[bone.name] === false) continue;

    const off = i * POSE_STRIDE;
    const bx  = worldPose[off + PX];
    const by  = worldPose[off + PY];

    // Line to parent
    if (bone.parentIndex !== -1) {
      const parent = skeleton.bones[bone.parentIndex];
      if (vis[parent.name] !== false) {
        const po = bone.parentIndex * POSE_STRIDE;
        ctx.strokeStyle = 'rgba(100,200,255,0.5)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(worldPose[po + PX], worldPose[po + PY]);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }

    // Dot
    const tags = bone.tags;
    ctx.fillStyle = tags.includes('anchor') ? 'rgba(150,150,150,0.8)'
                  : tags.includes('face')   ? 'rgba(255,220,60,0.8)'
                  : tags.includes('accent') ? 'rgba(180,80,255,0.8)'
                  :                           'rgba(80,180,255,0.8)';
    ctx.beginPath();
    ctx.arc(bx, by, 1, 0, Math.PI * 2);
    ctx.fill();

    // Name label
    if (state.showNames) {
      ctx.fillStyle = 'rgba(200,200,200,0.7)';
      ctx.font = '1.5px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(bone.name, bx + 1.5, by - 1);
    }
  }
}

function drawSlotOverlay(ctx, model) {
  for (const slot of model.resolvedSlots) {
    if (slot.boneIndex === -1) continue;
    const off = slot.boneIndex * POSE_STRIDE;
    ctx.fillStyle = 'rgba(255,150,50,0.7)';
    ctx.font = '1.2px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(slot.name, model.worldPose[off + PX], model.worldPose[off + PY] + 2.5);
  }
}

requestAnimationFrame(render);

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
    '../src/renderer/creatures/progression.js',
    '../src/renderer/creatures/progression-visuals.js',
  ], () => {
    console.log('[studio] Hot reload — rebuilding rig');
    rebuildRig();
    if (state.showAll) rebuildAllRigs();
  });
}
