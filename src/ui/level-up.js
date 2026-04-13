/**
 * Level-up screen UI.
 * Shows upgrade choices and handles selection.
 */

export function createLevelUpUI(container) {
  let active = false;
  let onSelect = null;

  function show(choices, callback) {
    active = true;
    onSelect = callback;
    container.classList.remove('hidden');

    container.innerHTML = `
      <div class="level-up-title">LEVEL UP</div>
      <div class="upgrade-options">
        ${choices.map(c => `
          <div class="upgrade-card" data-id="${c.id}">
            <h3>${c.name}</h3>
            <p>${c.desc}</p>
          </div>
        `).join('')}
      </div>
    `;

    container.querySelectorAll('.upgrade-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        hide();
        if (onSelect) onSelect(id);
      });
    });
  }

  function hide() {
    active = false;
    container.classList.add('hidden');
    container.innerHTML = '';
  }

  return {
    get active() { return active; },
    show,
    hide,
  };
}
