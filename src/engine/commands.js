/**
 * Command/event layer between input and engine.
 * All player actions pass through here as data.
 */

export const CMD = {
  MOVE: 'move',
  ATTACK: 'attack',
  USE_SKILL: 'use_skill',
  SELECT_UPGRADE: 'select_upgrade',
  PAUSE: 'pause',
};

export function createCommandQueue() {
  let queue = [];

  return {
    push(type, data = {}) {
      queue.push({ type, data, time: performance.now() });
    },

    drain() {
      const cmds = queue;
      queue = [];
      return cmds;
    },

    peek() {
      return queue;
    },

    clear() {
      queue = [];
    },
  };
}
