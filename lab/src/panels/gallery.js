/**
 * Gallery Panel — grid of live simulation canvases.
 *
 * Wires SimGallery + SimControls together.
 * Shows per-tile overlay with policy name, stats, alive/dead status.
 */

import { createSimGallery } from '../components/sim-gallery.js';
import { createSimControls } from '../components/sim-controls.js';

export function createGalleryPanel() {
  let gallery = null;
  let controls = null;
  let gridEl = null;
  let emptyEl = null;
  let tileMap = new Map(); // instance id -> tile DOM elements
  let statsRafId = null;

  function createTile(instance, container) {
    const tile = document.createElement('div');
    tile.className = 'sim-tile';

    // Canvas
    tile.appendChild(instance.canvas);

    // Overlay (policy + status)
    const overlay = document.createElement('div');
    overlay.className = 'sim-tile__overlay';

    const policyEl = document.createElement('span');
    policyEl.className = 'sim-tile__policy';
    policyEl.textContent = instance.policyId;

    const statusEl = document.createElement('span');
    statusEl.className = 'sim-tile__status sim-tile__status--alive';
    statusEl.textContent = 'alive';

    overlay.append(policyEl, statusEl);
    tile.appendChild(overlay);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'sim-tile__close';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', () => {
      gallery.remove(instance.id);
    });
    tile.appendChild(closeBtn);

    // Stats bar
    const statsBar = document.createElement('div');
    statsBar.className = 'sim-tile__stats';

    const timeStat = createStat('time', '0:00');
    const waveStat = createStat('wave', '0');
    const killsStat = createStat('kills', '0');
    const levelStat = createStat('lv', '1');

    statsBar.append(timeStat.el, waveStat.el, killsStat.el, levelStat.el);
    tile.appendChild(statsBar);

    container.appendChild(tile);

    // Renderer needs real DOM dimensions — resize now that canvas is mounted
    instance.mount();

    tileMap.set(instance.id, {
      tile,
      statusEl,
      timeStat,
      waveStat,
      killsStat,
      levelStat,
    });
  }

  function createStat(label, value) {
    const el = document.createElement('span');
    el.className = 'sim-tile__stat';

    const labelEl = document.createElement('span');
    labelEl.className = 'sim-tile__stat-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'sim-tile__stat-value';
    valueEl.textContent = value;

    el.append(labelEl, valueEl);

    return {
      el,
      update(v) { valueEl.textContent = v; },
    };
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function updateStats() {
    statsRafId = requestAnimationFrame(updateStats);

    for (const inst of gallery.instances) {
      const state = inst.getState();
      const refs = tileMap.get(inst.id);
      if (!refs) continue;

      refs.timeStat.update(formatTime(state.gameTime));
      refs.waveStat.update(String(state.wave));
      refs.killsStat.update(String(state.kills));
      refs.levelStat.update(String(state.level));

      if (!state.alive) {
        refs.statusEl.textContent = 'dead';
        refs.statusEl.className = 'sim-tile__status sim-tile__status--dead';
        refs.tile.classList.add('sim-tile--dead');
      }
    }
  }

  function syncGrid() {
    // Update count
    controls.updateCount(gallery.instances.length);

    // Show/hide empty state
    const isEmpty = gallery.instances.length === 0;
    emptyEl.style.display = isEmpty ? '' : 'none';
    gridEl.style.display = isEmpty ? 'none' : '';

    // Remove tiles for instances that no longer exist
    const currentIds = new Set(gallery.instances.map(i => i.id));
    for (const [id, refs] of tileMap) {
      if (!currentIds.has(id)) {
        refs.tile.remove();
        tileMap.delete(id);
      }
    }

    // Add tiles for new instances
    for (const inst of gallery.instances) {
      if (!tileMap.has(inst.id)) {
        createTile(inst, gridEl);
      }
    }
  }

  return {
    id: 'gallery',
    label: 'Gallery',

    create(container) {
      const panel = document.createElement('div');
      panel.className = 'gallery-panel';

      gallery = createSimGallery();
      gallery.onChange = syncGrid;

      // Controls
      const controlsWrap = document.createElement('div');
      controls = createSimControls(controlsWrap, {
        policies: gallery.listPolicies(),
        onAdd(policyId) {
          gallery.add({ policyId });
        },
        onSpeedChange(speed) {
          gallery.setSpeed(speed);
        },
        onClear() {
          gallery.clear();
        },
      });
      panel.appendChild(controlsWrap);

      // Empty state
      emptyEl = document.createElement('div');
      emptyEl.className = 'gallery-panel__empty';
      emptyEl.innerHTML = `
        <div class="gallery-panel__empty-title">No simulations running</div>
        <div class="gallery-panel__empty-hint">Click "Add Simulation" to start watching AI play</div>
      `;
      panel.appendChild(emptyEl);

      // Grid
      gridEl = document.createElement('div');
      gridEl.className = 'sim-gallery__grid';
      gridEl.style.display = 'none';
      panel.appendChild(gridEl);

      container.appendChild(panel);

      // Start stats update loop
      statsRafId = requestAnimationFrame(updateStats);
    },

    destroy() {
      if (statsRafId !== null) {
        cancelAnimationFrame(statsRafId);
        statsRafId = null;
      }
      if (gallery) {
        gallery.destroy();
        gallery = null;
      }
      if (controls) {
        controls.destroy();
        controls = null;
      }
      tileMap.clear();
      gridEl = null;
      emptyEl = null;
    },
  };
}
