/**
 * Game over screen.
 */

export function createGameOverUI(container) {
  let active = false;
  let onRestart = null;

  function show(stats, callback) {
    active = true;
    onRestart = callback;
    container.classList.remove('hidden');

    container.innerHTML = `
      <div class="game-over-title">GAME OVER</div>
      <div class="game-over-stats">
        <div>Time survived: ${Math.floor(stats.time / 60)}m ${Math.floor(stats.time % 60)}s</div>
        <div>Level reached: ${stats.level}</div>
        <div>Total kills: ${stats.kills}</div>
        <div>Wave reached: ${stats.wave + 1}</div>
      </div>
      <button class="glow-btn" id="restart-btn">PLAY AGAIN</button>
    `;

    container.querySelector('#restart-btn').addEventListener('click', () => {
      hide();
      if (onRestart) onRestart();
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
