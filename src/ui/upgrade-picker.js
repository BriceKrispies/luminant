/**
 * Upgrade picker presenter.
 *
 * Pure DOM adapter for an 'upgrade' decision request. The decision manager
 * owns the queue and deadline; this module only renders cards and reports
 * the user's pick (or cancellation) back via the provided `resolve` callback.
 *
 * Presenter contract (consumed by src/decisions/manager.js):
 *   present(request, options, resolve)  — show cards; call resolve(choiceId) on click
 *   cancel()                            — hide/clear; manager won't call resolve again
 *
 * The manager handles auto-pick via policy on timeout — the presenter only
 * cares about human input.
 */

const HIDE_DURATION = 250;

export function createUpgradePicker(container) {
  let activeResolve = null;
  let picking = false;

  function renderCards(options, level) {
    const tierClass = (tier) =>
      tier === 1 ? ' tier-1' : tier === 2 ? ' tier-2' : '';

    container.innerHTML = `
      <div class="upgrade-picker-row">
        ${options.map(c => {
          const tier = (c.meta && c.meta.tier) || c.tier;
          const name = c.label || c.name || c.id;
          const desc = (c.meta && c.meta.desc) || c.desc || '';
          return `
            <div class="upgrade-picker-card${tierClass(tier)}" data-id="${c.id}">
              <div class="upgrade-picker-card-name">${name}</div>
              <div class="upgrade-picker-card-desc">${desc}</div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="upgrade-picker-timer"><div class="upgrade-picker-timer-fill"></div></div>
    `;

    container.querySelectorAll('.upgrade-picker-card').forEach(card => {
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

    const row = container.querySelector('.upgrade-picker-row');
    if (row) row.classList.add('hiding');

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
    /** Presenter contract — show cards for this request. */
    present(request, options, resolve) {
      activeResolve = resolve;
      picking = false;
      container.classList.remove('hidden');
      const level = request.context ? request.context.level : undefined;
      renderCards(options, level);
    },

    /** Presenter contract — manager is aborting (game over, restart). */
    cancel() {
      activeResolve = null;
      picking = false;
      container.classList.add('hidden');
      container.innerHTML = '';
    },

    /** Back-compat helper for main.js: called when returning to menu. */
    reset() {
      this.cancel();
    },
  };
}
