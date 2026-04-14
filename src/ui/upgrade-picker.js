/**
 * Non-pausing upgrade picker.
 * Shows upgrade choices at the bottom of the screen without stopping gameplay.
 * Queues multiple level-ups and shows one row at a time.
 * Auto-picks via AI after a timeout if the user doesn't choose.
 */

const AUTO_PICK_DELAY = 5000; // 5 seconds
const HIDE_DURATION = 250;    // slide-down animation
const NEXT_DELAY = 400;       // pause between queued sets

export function createUpgradePicker(container, { autoPlayer, onPick }) {
  const queue = [];
  let current = null;   // { choices, level }
  let picking = false;  // double-tap guard
  let timeoutId = null;

  function enqueue(choices, level) {
    queue.push({ choices, level });
    if (!current) showNext();
  }

  function showNext() {
    if (queue.length === 0) {
      current = null;
      return;
    }

    current = queue.shift();
    picking = false;
    container.classList.remove('hidden');
    renderCards(current.choices, current.level);
    startTimer();
  }

  function renderCards(choices, level) {
    const tierClass = (tier) =>
      tier === 1 ? ' tier-1' : tier === 2 ? ' tier-2' : '';

    container.innerHTML = `
      <div class="upgrade-picker-row">
        ${choices.map(c => `
          <div class="upgrade-picker-card${tierClass(c.tier)}" data-id="${c.id}">
            <div class="upgrade-picker-card-name">${c.name}</div>
            <div class="upgrade-picker-card-desc">${c.desc}</div>
          </div>
        `).join('')}
      </div>
      <div class="upgrade-picker-timer"><div class="upgrade-picker-timer-fill"></div></div>
    `;

    container.querySelectorAll('.upgrade-picker-card').forEach(card => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        pick(card.dataset.id);
      });
      // Prevent touch from propagating to game canvas
      card.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    });
  }

  function startTimer() {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      if (!current) return;
      // AI picks
      const chosenId = autoPlayer.chooseUpgrade(current.choices);
      pick(chosenId || current.choices[0].id);
    }, AUTO_PICK_DELAY);
  }

  function pick(upgradeId) {
    if (picking || !current) return;
    picking = true;
    clearTimeout(timeoutId);

    // Flash chosen card
    const card = container.querySelector(`[data-id="${upgradeId}"]`);
    if (card) card.classList.add('picked');

    // Apply upgrade
    onPick(upgradeId, current.level);

    // Hide with animation, then show next
    const row = container.querySelector('.upgrade-picker-row');
    if (row) row.classList.add('hiding');

    setTimeout(() => {
      container.classList.add('hidden');
      container.innerHTML = '';
      current = null;

      if (queue.length > 0) {
        setTimeout(showNext, NEXT_DELAY - HIDE_DURATION);
      }
    }, HIDE_DURATION);
  }

  function reset() {
    clearTimeout(timeoutId);
    queue.length = 0;
    current = null;
    picking = false;
    container.classList.add('hidden');
    container.innerHTML = '';
  }

  return {
    enqueue,
    reset,
    get active() { return current !== null; },
    get queueLength() { return queue.length; },
  };
}
