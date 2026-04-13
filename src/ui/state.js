/**
 * App state machine.
 * Tracks which screen is active and which game mode was selected.
 * UI and main.js read this; only menu actions mutate it.
 */

export const AppState = {
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAME_OVER: 'game_over',
};

export const GameMode = {
  MANUAL: 'manual',
  AUTO: 'auto',
};

export function createAppState() {
  let screen = AppState.MENU;
  let mode = GameMode.MANUAL;
  const listeners = [];

  return {
    get screen() { return screen; },
    get mode() { return mode; },

    setScreen(s) {
      screen = s;
      for (const fn of listeners) fn(screen, mode);
    },

    setMode(m) {
      mode = m;
    },

    onChange(fn) {
      listeners.push(fn);
    },
  };
}
