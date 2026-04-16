/**
 * SimControls — control bar for the simulation gallery.
 *
 * Creates DOM elements for: add simulation, policy selector,
 * speed control, clear all, instance count.
 */

export function createSimControls(container, options = {}) {
  const { policies = [], onAdd, onSpeedChange, onClear } = options;

  const el = document.createElement('div');
  el.className = 'sim-controls';

  // Policy selector group
  const addGroup = document.createElement('div');
  addGroup.className = 'sim-controls__group';

  const policyLabel = document.createElement('span');
  policyLabel.className = 'sim-controls__label';
  policyLabel.textContent = 'Policy';

  const policySelect = document.createElement('select');
  policySelect.className = 'sim-controls__select';
  for (const pid of policies) {
    const opt = document.createElement('option');
    opt.value = pid;
    opt.textContent = pid;
    policySelect.appendChild(opt);
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'sim-controls__btn';
  addBtn.textContent = 'Add Simulation';
  addBtn.addEventListener('click', () => {
    if (onAdd) onAdd(policySelect.value);
  });

  addGroup.append(policyLabel, policySelect, addBtn);

  // Speed group
  const speedGroup = document.createElement('div');
  speedGroup.className = 'sim-controls__group';

  const speedLabel = document.createElement('span');
  speedLabel.className = 'sim-controls__label';
  speedLabel.textContent = 'Speed';

  const speedBtns = [];
  for (const s of [1, 2, 4, 8]) {
    const btn = document.createElement('button');
    btn.className = 'sim-controls__speed-btn' + (s === 1 ? ' active' : '');
    btn.textContent = `${s}x`;
    btn.dataset.speed = s;
    btn.addEventListener('click', () => {
      if (onSpeedChange) onSpeedChange(s);
      for (const b of speedBtns) b.classList.toggle('active', b === btn);
    });
    speedBtns.push(btn);
  }

  speedGroup.append(speedLabel, ...speedBtns);

  // Clear button
  const clearBtn = document.createElement('button');
  clearBtn.className = 'sim-controls__btn sim-controls__btn--danger';
  clearBtn.textContent = 'Clear All';
  clearBtn.addEventListener('click', () => {
    if (onClear) onClear();
  });

  // Count display
  const countEl = document.createElement('span');
  countEl.className = 'sim-controls__count';
  countEl.textContent = '0 sims';

  el.append(addGroup, speedGroup, clearBtn, countEl);
  container.appendChild(el);

  return {
    el,
    updateCount(n) {
      countEl.textContent = `${n} sim${n !== 1 ? 's' : ''}`;
    },
    destroy() {
      el.remove();
    },
  };
}
