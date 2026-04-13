/**
 * Main menu UI.
 * Creates and manages the menu screen. Fires callbacks on user action.
 * Does NOT touch engine or game systems — only communicates via callbacks.
 */

import { AppState, GameMode } from './state.js';
import { listPolicies } from '../ai/policy-types.js';

// Ensure policies are registered
import '../ai/policies/survival.js';
import '../ai/policies/progression.js';

export function createMenuUI(container, appState) {
  let onStart = null;
  let selectedPolicy = 'survival';

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
    const policies = listPolicies();
    const policyOptions = policies.map(p =>
      `<option value="${p}" ${p === selectedPolicy ? 'selected' : ''}>${p}</option>`
    ).join('');

    return `
      <div class="menu-content">
        <h1 class="menu-title">LUMINANT</h1>
        <p class="menu-subtitle">Survive the swarm</p>
        <div class="menu-buttons">
          ${showResume ? '<button class="glow-btn menu-btn" data-action="resume">RESUME</button>' : ''}
          <button class="glow-btn menu-btn" data-action="start">START GAME</button>
          <div class="menu-auto-group">
            <button class="glow-btn menu-btn menu-btn--auto" data-action="auto">AUTO MODE</button>
            <select class="policy-select" id="policy-select">${policyOptions}</select>
          </div>
        </div>
        <div class="menu-hint">
          <p>WASD to move &middot; Click to attack</p>
          <p>Touch: joystick + attack button</p>
          <p>F3: debug overlay</p>
        </div>
      </div>
    `;
  }

  function bind() {
    const policySelect = container.querySelector('#policy-select');
    if (policySelect) {
      policySelect.addEventListener('change', (e) => {
        selectedPolicy = e.target.value;
      });
    }

    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.currentTarget.dataset.action;
        if (action === 'start') {
          appState.setMode(GameMode.MANUAL);
          appState.setScreen(AppState.PLAYING);
          if (onStart) onStart(GameMode.MANUAL);
        } else if (action === 'auto') {
          appState.setMode(GameMode.AUTO);
          appState.setScreen(AppState.PLAYING);
          if (onStart) onStart(GameMode.AUTO, selectedPolicy);
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
    get selectedPolicy() { return selectedPolicy; },
  };
}
