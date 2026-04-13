/**
 * Creates a lightweight read-only snapshot of the current simulation state.
 * The renderer consumes snapshots rather than reading live engine memory.
 */

import { MAX_ENTITIES, ENTITY_STRIDE, FIELD, STATE, TYPE } from './bindings.js';

export function createSnapshot(engine) {
  const entities = [];
  const buf = engine.mem;
  let enemyCount = 0;
  let projectileCount = 0;
  let pickupCount = 0;

  const playerId = engine.getPlayerId();
  let player = null;

  for (let id = 0; id < MAX_ENTITIES; id++) {
    const base = id * ENTITY_STRIDE;
    const state = buf.getInt32(base + FIELD.STATE, true);
    if (state === STATE.FREE) continue;

    const type = buf.getInt32(base + FIELD.TYPE, true);
    const e = {
      id,
      x: buf.getFloat32(base + FIELD.X, true),
      y: buf.getFloat32(base + FIELD.Y, true),
      vx: buf.getFloat32(base + FIELD.VX, true),
      vy: buf.getFloat32(base + FIELD.VY, true),
      hp: buf.getFloat32(base + FIELD.HP, true),
      maxHp: buf.getFloat32(base + FIELD.MAX_HP, true),
      type,
      state,
      radius: buf.getFloat32(base + FIELD.RADIUS, true),
      damage: buf.getFloat32(base + FIELD.DAMAGE, true),
      speed: buf.getFloat32(base + FIELD.SPEED, true),
    };

    if (id === playerId) player = e;
    if (type >= 2 && type <= 9) enemyCount++;
    if (type >= 10 && type <= 19) projectileCount++;
    if (type >= 20) pickupCount++;

    entities.push(e);
  }

  return {
    entities,
    player,
    enemyCount,
    projectileCount,
    pickupCount,
    activeCount: engine.getActiveCount(),
    time: engine.getTime(),
    metrics: engine.getMetrics(),
  };
}
