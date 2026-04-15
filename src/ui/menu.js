/**
 * Main menu UI.
 * Creates and manages the menu screen. Fires callbacks on user action.
 * Does NOT touch engine or game systems — only communicates via callbacks.
 */

import { AppState } from './state.js';

// Ensure brawler policy is registered
import '../systems/player-ai/policies/brawler.js';

export function createMenuUI(container, appState) {
  let onStart = null;

  function render() {
    const screen = appState.screen;

    if (screen === AppState.MENU || screen === AppState.PAUSED) {
      container.classList.remove('hidden');
      container.innerHTML = buildHTML(screen === AppState.PAUSED);
      bind();
    } else {
      container.classList.add('hidden');
    }
  }

  function buildHTML(showResume) {
    return `
      <div class="menu-content">
        <h1 class="menu-title">LUMINANT</h1>
        <p class="menu-subtitle">Survive the swarm</p>
        <div class="menu-buttons">
          ${showResume ? '<button class="glow-btn menu-btn" data-action="resume">RESUME</button>' : ''}
          <button class="glow-btn menu-btn" data-action="start">START</button>
        </div>
        <div class="menu-hint">
          <p>F3: debug overlay &middot; F4: toggle renderer</p>
        </div>
      </div>
    `;
  }

  function bind() {
    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.currentTarget.dataset.action;
        if (action === 'start') {
          appState.setScreen(AppState.PLAYING);
          if (onStart) onStart();
        } else if (action === 'resume') {
          appState.setScreen(AppState.PLAYING);
        }
      });
    });
  }

  // Re-render when state changes
  appState.onChange(() => render());

  // Initial render
  render();

  return {
    onStart(fn) { onStart = fn; },
  };
}
