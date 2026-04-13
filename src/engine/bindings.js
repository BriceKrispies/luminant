/**
 * High-level JS bindings for the WAT engine.
 *
 * Provides typed accessors over raw WASM memory and wraps engine exports
 * into a structured API. The renderer and game systems consume this layer
 * rather than touching WASM memory directly.
 */

// Entity field byte offsets (must match core.wat)
export const ENTITY_STRIDE = 64;
export const MAX_ENTITIES = 4096;
export const FIELD = {
  X: 0, Y: 4, VX: 8, VY: 12,
  HP: 16, MAX_HP: 20,
  TYPE: 24, STATE: 28,
  RADIUS: 32, DAMAGE: 36,
  SPEED: 40, XP_VALUE: 44,
  COOLDOWN: 48, FACING: 52,
  FLAGS: 56, LIFETIME: 60,
};

// Entity types (must match core.wat)
export const TYPE = {
  NONE: 0, PLAYER: 1,
  ENEMY_BASIC: 2, ENEMY_FAST: 3, ENEMY_TANK: 4, ENEMY_RANGED: 5,
  PROJECTILE_BULLET: 10, PROJECTILE_SPREAD: 11, PROJECTILE_AOE: 12,
  PICKUP_XP: 20, PICKUP_HEALTH: 21,
};

// Entity states
export const STATE = { FREE: 0, ACTIVE: 1, DYING: 2 };

// Memory layout addresses
const METRICS_BASE = 0x84500;
const GLOBALS_BASE = 0x84000;

export class EngineBindings {
  constructor(exports) {
    this.wasm = exports;
    this.mem = new DataView(exports.memory.buffer);
    this.f32 = new Float32Array(exports.memory.buffer);
    this.i32 = new Int32Array(exports.memory.buffer);
    this.u8 = new Uint8Array(exports.memory.buffer);
  }

  // Rebind typed arrays after memory growth
  _rebind() {
    const buf = this.wasm.memory.buffer;
    this.mem = new DataView(buf);
    this.f32 = new Float32Array(buf);
    this.i32 = new Int32Array(buf);
    this.u8 = new Uint8Array(buf);
  }

  // ---- Lifecycle ----

  init(worldW = 4096, worldH = 4096) {
    this.wasm.init(worldW, worldH);
    this._rebind();
    this.worldW = worldW;
    this.worldH = worldH;
  }

  step(dt) {
    this.wasm.step(dt);
  }

  // ---- Entity management ----

  spawnEntity(type, x, y, hp, speed, radius, damage, xpValue) {
    return this.wasm.spawn_entity(type, x, y, hp, speed, radius, damage, xpValue);
  }

  despawnEntity(id) {
    this.wasm.despawn_entity(id);
  }

  // ---- Entity field access ----

  getF32(id, fieldOffset) {
    return this.mem.getFloat32((id * ENTITY_STRIDE) + fieldOffset, true);
  }

  setF32(id, fieldOffset, value) {
    this.mem.setFloat32((id * ENTITY_STRIDE) + fieldOffset, value, true);
  }

  getI32(id, fieldOffset) {
    return this.mem.getInt32((id * ENTITY_STRIDE) + fieldOffset, true);
  }

  setI32(id, fieldOffset, value) {
    this.mem.setInt32((id * ENTITY_STRIDE) + fieldOffset, value, true);
  }

  getEntityX(id) { return this.getF32(id, FIELD.X); }
  getEntityY(id) { return this.getF32(id, FIELD.Y); }
  getEntityVX(id) { return this.getF32(id, FIELD.VX); }
  getEntityVY(id) { return this.getF32(id, FIELD.VY); }
  getEntityHP(id) { return this.getF32(id, FIELD.HP); }
  getEntityMaxHP(id) { return this.getF32(id, FIELD.MAX_HP); }
  getEntityType(id) { return this.getI32(id, FIELD.TYPE); }
  getEntityState(id) { return this.getI32(id, FIELD.STATE); }
  getEntityRadius(id) { return this.getF32(id, FIELD.RADIUS); }
  getEntityDamage(id) { return this.getF32(id, FIELD.DAMAGE); }
  getEntitySpeed(id) { return this.getF32(id, FIELD.SPEED); }
  getEntityXPValue(id) { return this.getF32(id, FIELD.XP_VALUE); }

  // ---- Player ----

  setPlayerInput(dx, dy, attack) {
    this.wasm.set_player_input(dx, dy, attack ? 1 : 0);
  }

  setPlayerId(id) { this.wasm.set_player_id(id); }
  getPlayerId() { return this.wasm.get_player_id(); }
  getAttackFlag() { return this.wasm.get_attack_flag(); }
  clearAttackFlag() { this.wasm.clear_attack_flag(); }

  // ---- Queries ----

  getActiveCount() { return this.wasm.get_active_count(); }
  getTime() { return this.wasm.get_time(); }
  getKills() { return this.wasm.get_kills(); }

  gridQuery(x, y, radius) {
    const count = this.wasm.grid_query(x, y, radius);
    const results = [];
    for (let i = 0; i < count; i++) {
      results.push(this.wasm.get_query_result(i));
    }
    return results;
  }

  // ---- Combat ----

  applyDamage(id, amount) { this.wasm.apply_damage(id, amount); }

  setEntityVelocity(id, vx, vy) {
    this.wasm.set_entity_velocity(id, vx, vy);
  }

  setEntityLifetime(id, lt) {
    this.wasm.set_entity_lifetime(id, lt);
  }

  // ---- Metrics (from memory) ----

  getMetrics() {
    return {
      kills: this.mem.getInt32(METRICS_BASE, true),
      collisionChecks: this.mem.getInt32(METRICS_BASE + 4, true),
      damageEvents: this.mem.getInt32(METRICS_BASE + 8, true),
      activeEntities: this.mem.getInt32(METRICS_BASE + 12, true),
    };
  }

  // ---- Iteration helpers ----

  /** Iterate all entities with state != FREE, calling fn(id, type, state) */
  forEachEntity(fn) {
    const buf = this.mem;
    for (let id = 0; id < MAX_ENTITIES; id++) {
      const base = id * ENTITY_STRIDE;
      const state = buf.getInt32(base + FIELD.STATE, true);
      if (state === STATE.FREE) continue;
      const type = buf.getInt32(base + FIELD.TYPE, true);
      fn(id, type, state);
    }
  }

  /** Iterate only active entities of given types */
  forEachActive(typeFilter, fn) {
    const buf = this.mem;
    for (let id = 0; id < MAX_ENTITIES; id++) {
      const base = id * ENTITY_STRIDE;
      if (buf.getInt32(base + FIELD.STATE, true) !== STATE.ACTIVE) continue;
      const type = buf.getInt32(base + FIELD.TYPE, true);
      if (typeFilter && !typeFilter.includes(type)) continue;
      fn(id, type);
    }
  }

  /** Count active entities of a given type range */
  countByType(minType, maxType) {
    let count = 0;
    const buf = this.mem;
    for (let id = 0; id < MAX_ENTITIES; id++) {
      const base = id * ENTITY_STRIDE;
      if (buf.getInt32(base + FIELD.STATE, true) !== STATE.ACTIVE) continue;
      const t = buf.getInt32(base + FIELD.TYPE, true);
      if (t >= minType && t <= maxType) count++;
    }
    return count;
  }
}
