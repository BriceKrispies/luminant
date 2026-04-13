/**
 * Touch controls — virtual joystick + attack button.
 * Translates touch events into the same input state shape as keyboard/mouse.
 * Only active in manual mode. Hidden on desktop (shown via CSS media query).
 */

export function createTouchControls(container) {
  let stickDx = 0;
  let stickDy = 0;
  let attacking = false;
  let stickActive = false;
  let stickTouchId = null;
  let stickOriginX = 0;
  let stickOriginY = 0;

  const STICK_MAX = 50; // max pixel drag distance

  // Create DOM elements
  const stickArea = document.createElement('div');
  stickArea.className = 'touch-stick-area';
  stickArea.innerHTML = '<div class="touch-stick-ring"><div class="touch-stick-knob"></div></div>';

  const attackBtn = document.createElement('div');
  attackBtn.className = 'touch-attack-btn';
  attackBtn.textContent = 'ATK';

  container.appendChild(stickArea);
  container.appendChild(attackBtn);

  const knob = stickArea.querySelector('.touch-stick-knob');
  const ring = stickArea.querySelector('.touch-stick-ring');

  // --- Joystick ---
  stickArea.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    stickTouchId = t.identifier;
    stickActive = true;
    const rect = stickArea.getBoundingClientRect();
    stickOriginX = rect.left + rect.width / 2;
    stickOriginY = rect.top + rect.height / 2;
    ring.classList.add('active');
  }, { passive: false });

  stickArea.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== stickTouchId) continue;
      let dx = t.clientX - stickOriginX;
      let dy = t.clientY - stickOriginY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > STICK_MAX) {
        dx = (dx / dist) * STICK_MAX;
        dy = (dy / dist) * STICK_MAX;
      }
      stickDx = dx / STICK_MAX;
      stickDy = dy / STICK_MAX;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  }, { passive: false });

  function releaseStick() {
    stickActive = false;
    stickTouchId = null;
    stickDx = 0;
    stickDy = 0;
    knob.style.transform = '';
    ring.classList.remove('active');
  }

  stickArea.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickTouchId) releaseStick();
    }
  });
  stickArea.addEventListener('touchcancel', releaseStick);

  // --- Attack button ---
  attackBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    attacking = true;
    attackBtn.classList.add('active');
  }, { passive: false });

  attackBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    attacking = false;
    attackBtn.classList.remove('active');
  }, { passive: false });

  attackBtn.addEventListener('touchcancel', () => {
    attacking = false;
    attackBtn.classList.remove('active');
  });

  return {
    get dx() { return stickDx; },
    get dy() { return stickDy; },
    get attacking() { return attacking; },
    get active() { return stickActive || attacking; },

    show() { container.classList.remove('hidden'); },
    hide() { container.classList.add('hidden'); },
  };
}
