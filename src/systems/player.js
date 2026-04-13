/**
 * Player controller system.
 * Reads input, drives the engine's player entity.
 */

import { TYPE } from '../engine/bindings.js';

const PLAYER_DEFAULTS = {
  hp: 100,
  speed: 180,
  radius: 12,
  damage: 0, // Contact damage (player doesn't deal contact damage)
};

export function createPlayerSystem(engine) {
  let playerId = -1;

  return {
    get id() { return playerId; },

    spawn(x, y, overrides = {}) {
      const cfg = { ...PLAYER_DEFAULTS, ...overrides };
      playerId = engine.spawnEntity(
        TYPE.PLAYER, x, y,
        cfg.hp, cfg.speed, cfg.radius, cfg.damage, 0
      );
      engine.setPlayerId(playerId);
      return playerId;
    },

    /** Read input state and push to engine */
    applyInput(input) {
      if (playerId < 0) return;
      const { dx, dy } = input.getMovement();
      const attacking = input.mouseDown;
      engine.setPlayerInput(dx, dy, attacking);
    },

    getPosition() {
      if (playerId < 0) return { x: 0, y: 0 };
      return {
        x: engine.getEntityX(playerId),
        y: engine.getEntityY(playerId),
      };
    },

    getHP() {
      if (playerId < 0) return 0;
      return engine.getEntityHP(playerId);
    },

    getMaxHP() {
      if (playerId < 0) return 1;
      return engine.getEntityMaxHP(playerId);
    },

    isAlive() {
      if (playerId < 0) return false;
      return engine.getEntityHP(playerId) > 0;
    },

    modifySpeed(delta) {
      if (playerId < 0) return;
      const cur = engine.getEntitySpeed(playerId);
      engine.setF32(playerId, 40, cur + delta);
    },

    modifyMaxHP(delta) {
      if (playerId < 0) return;
      const cur = engine.getEntityMaxHP(playerId);
      engine.setF32(playerId, 20, cur + delta);
      // Also heal by the added amount
      const hp = engine.getEntityHP(playerId);
      engine.setF32(playerId, 16, Math.min(hp + delta, cur + delta));
    },

    heal(amount) {
      if (playerId < 0) return;
      const hp = engine.getEntityHP(playerId);
      const max = engine.getEntityMaxHP(playerId);
      engine.setF32(playerId, 16, Math.min(hp + amount, max));
    },

    reset() {
      playerId = -1;
    },
  };
}
