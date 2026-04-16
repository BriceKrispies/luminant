/**
 * Lab App Shell — panel registry and hash-based routing.
 *
 * Registers panels, handles URL hash navigation, renders the
 * active panel. Future panels can be added by importing and
 * registering them here.
 */

import { createGalleryPanel } from './panels/gallery.js';

const panels = [
  createGalleryPanel(),
];

const panelMap = new Map(panels.map(p => [p.id, p]));
const DEFAULT_PANEL = 'gallery';

let activePanel = null;

function getHash() {
  const hash = window.location.hash.slice(1);
  return hash || DEFAULT_PANEL;
}

function renderNav() {
  const nav = document.getElementById('lab-nav');
  if (!nav) return;
  nav.innerHTML = '';

  for (const panel of panels) {
    const btn = document.createElement('button');
    btn.className = 'lab-nav-btn' + (panel.id === (activePanel?.id || DEFAULT_PANEL) ? ' active' : '');
    btn.textContent = panel.label;
    btn.addEventListener('click', () => {
      window.location.hash = panel.id;
    });
    nav.appendChild(btn);
  }
}

function switchPanel(id) {
  const container = document.getElementById('lab-panel-container');
  if (!container) return;

  // Destroy current panel
  if (activePanel) {
    activePanel.destroy();
    container.innerHTML = '';
  }

  // Create new panel
  const panel = panelMap.get(id) || panelMap.get(DEFAULT_PANEL);
  if (panel) {
    activePanel = panel;
    panel.create(container);
  }

  renderNav();
}

// Route on hash change
window.addEventListener('hashchange', () => {
  switchPanel(getHash());
});

// Initial render
switchPanel(getHash());
