/**
 * DOM-based HUD sub-system.
 * Builds HTML once, then efficiently updates only changed values each frame.
 */

export function createHUD(container) {
  // Build structure
  container.innerHTML = `
    <div class="hud-timer">0:00</div>
    <div class="hud-section hud-left">
      <div class="hud-weapon"></div>
      <div class="hud-hp-group">
        <div class="hud-hp-label">HP 0/0</div>
        <div class="hud-bar hp-bar"><div class="hud-bar-fill"></div></div>
      </div>
      <div class="hud-xp-group">
        <div class="hud-level">LV 1</div>
        <div class="hud-bar xp-bar"><div class="hud-bar-fill"></div></div>
      </div>
    </div>
    <div class="hud-section hud-right">
      <div class="hud-wave">Wave 1</div>
      <div class="hud-kills">Kills: 0</div>
    </div>
  `;

  // Cache element references
  const els = {
    timer: container.querySelector('.hud-timer'),
    weapon: container.querySelector('.hud-weapon'),
    hpLabel: container.querySelector('.hud-hp-label'),
    hpFill: container.querySelector('.hp-bar .hud-bar-fill'),
    hpGroup: container.querySelector('.hud-hp-group'),
    level: container.querySelector('.hud-level'),
    xpFill: container.querySelector('.xp-bar .hud-bar-fill'),
    wave: container.querySelector('.hud-wave'),
    kills: container.querySelector('.hud-kills'),
  };

  // Previous values for dirty-checking
  const prev = {};

  function update(state) {
    if (!state || !state.playing) return;

    // Timer
    const mins = Math.floor(state.time / 60);
    const secs = Math.floor(state.time % 60);
    const timeKey = mins * 60 + secs;
    if (prev.time !== timeKey) {
      prev.time = timeKey;
      els.timer.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Weapon
    if (prev.weapon !== state.weaponName) {
      prev.weapon = state.weaponName;
      els.weapon.textContent = state.weaponName || '';
    }

    // HP
    const hp = Math.ceil(state.hp);
    const maxHp = Math.ceil(state.maxHp);
    if (prev.hp !== hp || prev.maxHp !== maxHp) {
      prev.hp = hp;
      prev.maxHp = maxHp;
      els.hpLabel.textContent = `HP ${hp}/${maxHp}`;
      const ratio = state.maxHp > 0 ? Math.max(0, Math.min(1, state.hp / state.maxHp)) : 0;
      els.hpFill.style.width = (ratio * 100) + '%';

      // Conditional accent
      const critical = ratio < 0.3;
      const low = ratio < 0.5;
      els.hpGroup.classList.toggle('hp-critical', critical);
      els.hpGroup.classList.toggle('hp-low', low && !critical);
    }

    // XP
    const xpPct = state.xpToNext > 0 ? Math.min(1, state.xp / state.xpToNext) : 0;
    // Quantize to avoid sub-pixel thrash
    const xpKey = Math.round(xpPct * 1000);
    if (prev.xp !== xpKey) {
      prev.xp = xpKey;
      els.xpFill.style.width = (xpPct * 100) + '%';
    }

    // Level
    if (prev.level !== state.level) {
      prev.level = state.level;
      els.level.textContent = `LV ${state.level}`;
    }

    // Kills
    if (prev.kills !== state.kills) {
      prev.kills = state.kills;
      els.kills.textContent = `Kills: ${state.kills}`;
    }

    // Wave
    const wave = state.wave + 1;
    if (prev.wave !== wave) {
      prev.wave = wave;
      els.wave.textContent = `Wave ${wave}`;
    }
  }

  function show() {
    container.classList.remove('hidden');
  }

  function hide() {
    container.classList.add('hidden');
  }

  return { update, show, hide };
}
