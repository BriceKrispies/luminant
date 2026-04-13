/**
 * Input system — translates keyboard/mouse/touch into movement and attack commands.
 * Decoupled from engine: produces input state that the player controller reads.
 *
 * Supports source overriding: touch controls blend with keyboard,
 * and auto-player can override completely via setOverride().
 */

export function createInputSystem(canvas) {
  const keys = new Set();
  let mouseX = 0;
  let mouseY = 0;
  let mouseDown = false;
  let mouseClicked = false;

  // Override: auto-player or touch can inject values
  let override = null;
  let touchSource = null;

  function onKeyDown(e) {
    keys.add(e.code);
    e.preventDefault();
  }
  function onKeyUp(e) {
    keys.delete(e.code);
  }
  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
  }
  function onMouseDown(e) {
    if (e.button === 0) {
      mouseDown = true;
      mouseClicked = true;
    }
  }
  function onMouseUp(e) {
    if (e.button === 0) mouseDown = false;
  }
  function onContextMenu(e) {
    e.preventDefault();
  }

  // Bind
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('contextmenu', onContextMenu);

  return {
    get mouseX() {
      return override ? (override.targetX || mouseX) : mouseX;
    },
    get mouseY() {
      return override ? (override.targetY || mouseY) : mouseY;
    },
    get mouseDown() {
      if (override) return !!override.attack;
      if (touchSource && touchSource.attacking) return true;
      return mouseDown;
    },

    /** Attach a touch control source */
    setTouchSource(ts) {
      touchSource = ts;
    },

    /** Set full input override (auto-player). Pass null to clear. */
    setOverride(o) {
      override = o;
    },

    /** Returns normalized movement direction from WASD/arrows/touch/override */
    getMovement() {
      if (override) {
        return { dx: override.dx || 0, dy: override.dy || 0 };
      }

      let dx = 0;
      let dy = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) dy += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1;

      // Blend touch joystick if active
      if (touchSource && touchSource.active) {
        dx = touchSource.dx;
        dy = touchSource.dy;
      }

      return { dx, dy };
    },

    /** Returns true once per click (auto-resets) */
    consumeClick() {
      if (mouseClicked) {
        mouseClicked = false;
        return true;
      }
      return false;
    },

    isKeyDown(code) {
      return keys.has(code);
    },

    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
    },
  };
}
