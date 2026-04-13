/**
 * Predefined simulation scenarios for testing and benchmarking.
 */

import { TYPE } from '../src/engine/bindings.js';

export const SCENARIOS = {
  /** Basic swarm: enemies converge on stationary player */
  basicSwarm: {
    worldW: 4096,
    worldH: 4096,
    player: { x: 2048, y: 2048, hp: 9999 },
    enemies: Array.from({ length: 200 }, (_, i) => ({
      type: TYPE.ENEMY_BASIC,
      x: 2048 + Math.cos(i * 0.1) * (400 + i * 2),
      y: 2048 + Math.sin(i * 0.1) * (400 + i * 2),
      hp: 30, speed: 60, radius: 10, damage: 8, xp: 10,
    })),
    playerInput: { dx: 0, dy: 0, attack: 0 },
    ticks: 600,
  },

  /** Mixed types: varied enemy archetypes */
  mixedTypes: {
    worldW: 4096,
    worldH: 4096,
    player: { x: 2048, y: 2048, hp: 9999 },
    enemies: [
      ...Array.from({ length: 100 }, () => makeEnemy(TYPE.ENEMY_BASIC, 30, 60, 10, 8, 10)),
      ...Array.from({ length: 50 }, () => makeEnemy(TYPE.ENEMY_FAST, 15, 120, 7, 5, 8)),
      ...Array.from({ length: 30 }, () => makeEnemy(TYPE.ENEMY_TANK, 120, 35, 16, 20, 30)),
    ],
    playerInput: { dx: 0.5, dy: 0.3, attack: 0 },
    ticks: 600,
  },

  /** Stress test: maximum entity count */
  stress: {
    worldW: 4096,
    worldH: 4096,
    player: { x: 2048, y: 2048, hp: 99999 },
    enemies: Array.from({ length: 2000 }, () =>
      makeEnemy(TYPE.ENEMY_BASIC, 30, 60, 10, 8, 10)
    ),
    playerInput: { dx: 0, dy: 0, attack: 0 },
    ticks: 300,
  },
};

function makeEnemy(type, hp, speed, radius, damage, xp) {
  const angle = Math.random() * Math.PI * 2;
  const dist = 300 + Math.random() * 600;
  return {
    type, hp, speed, radius, damage, xp,
    x: 2048 + Math.cos(angle) * dist,
    y: 2048 + Math.sin(angle) * dist,
  };
}

/** Set up a scenario on an engine instance */
export function loadScenario(engine, scenario) {
  engine.init(scenario.worldW, scenario.worldH);

  const pid = engine.spawnEntity(
    TYPE.PLAYER, scenario.player.x, scenario.player.y,
    scenario.player.hp, 180, 12, 0, 0
  );
  engine.setPlayerId(pid);

  const inp = scenario.playerInput;
  engine.setPlayerInput(inp.dx, inp.dy, inp.attack);

  let spawned = 0;
  for (const e of scenario.enemies) {
    const id = engine.spawnEntity(e.type, e.x, e.y, e.hp, e.speed, e.radius, e.damage, e.xp);
    if (id >= 0) spawned++;
  }

  return { playerId: pid, spawned };
}
