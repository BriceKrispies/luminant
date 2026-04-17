/**
 * Archetype picker presenter.
 *
 * Blocking overlay shown once per run, before gameplay starts.
 * Main loop gates simulation on `decisions.blocking` until the user picks
 * (or a deadline expires and policy auto-picks).
 *
 * Presenter contract matches upgrade-picker:
 *   present(request, options, resolve) — show overlay
 *   cancel()                            — hide and drop (on returnToMenu)
 */

const HIDE_DURATION = 200;

export function createArchetypePicker(container) {
  let activeResolve = null;
  let picking = false;

  function render(options) {
    container.innerHTML = `
      <div class="archetype-picker-modal">
        <h2 class="archetype-picker-title">Choose your path</h2>
        <div class="archetype-picker-row">
          ${options.map(c => {
            const name = c.label || c.id;
            const desc = (c.meta && c.meta.desc) || '';
            return `
              <div class="archetype-picker-card" data-id="${c.id}">
                <div class="archetype-picker-card-name">${name}</div>
                <div class="archetype-picker-card-desc">${desc}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    container.querySelectorAll('.archetype-picker-card').forEach(card => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        onCardPick(card.dataset.id);
      });
      card.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    });
  }

  function onCardPick(choiceId) {
    if (picking) return;
    picking = true;

    const card = container.querySelector(`[data-id="${choiceId}"]`);
    if (card) card.classList.add('picked');

    const resolve = activeResolve;
    activeResolve = null;

    setTimeout(() => {
      container.classList.add('hidden');
      container.innerHTML = '';
      picking = false;
      if (resolve) resolve(choiceId);
    }, HIDE_DURATION);
  }

  return {
    present(request, options, resolve) {
      activeResolve = resolve;
      picking = false;
      container.classList.remove('hidden');
      render(options);
    },

    cancel() {
      activeResolve = null;
      picking = false;
      container.classList.add('hidden');
      container.innerHTML = '';
    },

    reset() { this.cancel(); },
  };
}
