/**
 * Tests for the procedural creature rendering system.
 *
 * Covers: archetype resolution, seeded variation determinism, state detection,
 * deformation composition, creature model resolver, fallback behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ARCHETYPES, TYPE_TO_ARCHETYPE, getArchetype, seededRandom, sampleVariation, buildVariation } from '../src/renderer/creatures/archetypes.js';
import { detectAnimState, wobble, breathing, squashStretch, hitReaction, deathAnim, composeDeformations } from '../src/renderer/creatures/deformations.js';
import { createCreatureResolver } from '../src/renderer/creatures/creature-model.js';
import { TYPE, STATE } from '../src/engine/bindings.js';

// ── Helpers ──

function makeEntity(overrides = {}) {
  return {
    id: 1,
    x: 100, y: 200,
    vx: 0, vy: 0,
    hp: 30, maxHp: 30,
    type: TYPE.ENEMY_BASIC,
    state: STATE.ACTIVE,
    radius: 10,
    damage: 8,
    speed: 60,
    facing: 0,
    ...overrides,
  };
}

// ── Archetypes ──

describe('Creature archetypes', () => {
  it('defines all four archetypes', () => {
    expect(ARCHETYPES.slime).toBeDefined();
    expect(ARCHETYPES.ghost).toBeDefined();
    expect(ARCHETYPES.ember).toBeDefined();
    expect(ARCHETYPES.brute).toBeDefined();
  });

  it('maps enemy types to archetypes', () => {
    expect(TYPE_TO_ARCHETYPE[TYPE.ENEMY_BASIC]).toBe('slime');
    expect(TYPE_TO_ARCHETYPE[TYPE.ENEMY_FAST]).toBe('ghost');
    expect(TYPE_TO_ARCHETYPE[TYPE.ENEMY_TANK]).toBe('brute');
    expect(TYPE_TO_ARCHETYPE[TYPE.ENEMY_RANGED]).toBe('ember');
  });

  it('getArchetype returns correct archetype for enemy types', () => {
    expect(getArchetype(TYPE.ENEMY_BASIC).id).toBe('slime');
    expect(getArchetype(TYPE.ENEMY_TANK).id).toBe('brute');
  });

  it('getArchetype returns null for non-enemy types', () => {
    expect(getArchetype(TYPE.PLAYER)).toBeNull();
    expect(getArchetype(TYPE.PROJECTILE_BULLET)).toBeNull();
    expect(getArchetype(TYPE.PICKUP_XP)).toBeNull();
  });

  it('all archetypes have required fields', () => {
    for (const [key, arch] of Object.entries(ARCHETYPES)) {
      expect(arch.id).toBe(key);
      expect(arch.body).toBeDefined();
      expect(arch.body.shape).toBeDefined();
      expect(arch.eyes).toBeDefined();
      expect(arch.palette).toBeDefined();
      expect(arch.palette.base).toHaveLength(3);
      expect(arch.palette.glow).toHaveLength(4);
      expect(arch.deform).toBeDefined();
      expect(arch.deform.wobble).toBeDefined();
      expect(arch.deform.breathing).toBeDefined();
      expect(arch.deform.hit).toBeDefined();
      expect(arch.deform.death).toBeDefined();
      expect(arch.variation).toBeDefined();
    }
  });
});

// ── Seeded variation ──

describe('Seeded variation', () => {
  it('produces deterministic values for the same seed', () => {
    const rng1 = seededRandom(42);
    const rng2 = seededRandom(42);
    const vals1 = [rng1(), rng1(), rng1()];
    const vals2 = [rng2(), rng2(), rng2()];
    expect(vals1).toEqual(vals2);
  });

  it('produces different values for different seeds', () => {
    const rng1 = seededRandom(42);
    const rng2 = seededRandom(99);
    const v1 = rng1();
    const v2 = rng2();
    expect(v1).not.toBe(v2);
  });

  it('values are in [0, 1) range', () => {
    const rng = seededRandom(123);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('sampleVariation maps to range', () => {
    const rng = seededRandom(42);
    const val = sampleVariation(rng, [10, 20]);
    expect(val).toBeGreaterThanOrEqual(10);
    expect(val).toBeLessThanOrEqual(20);
  });

  it('buildVariation produces consistent results per entity', () => {
    const arch = ARCHETYPES.slime;
    const v1 = buildVariation(arch, 42);
    const v2 = buildVariation(arch, 42);
    expect(v1.hueShift).toBe(v2.hueShift);
    expect(v1.scaleJitter).toBe(v2.scaleJitter);
    expect(v1.wobblePhase).toBe(v2.wobblePhase);
  });

  it('buildVariation produces different results for different entities', () => {
    const arch = ARCHETYPES.slime;
    const v1 = buildVariation(arch, 42);
    const v2 = buildVariation(arch, 99);
    // At least one value should differ
    const differs = v1.hueShift !== v2.hueShift ||
                    v1.scaleJitter !== v2.scaleJitter ||
                    v1.wobblePhase !== v2.wobblePhase;
    expect(differs).toBe(true);
  });
});

// ── Animation state detection ──

describe('Animation state detection', () => {
  it('returns dying for state=2', () => {
    const e = makeEntity({ state: STATE.DYING });
    expect(detectAnimState(e, 0)).toBe('dying');
  });

  it('returns hit when hitTimer > 0', () => {
    const e = makeEntity();
    expect(detectAnimState(e, 0.1)).toBe('hit');
  });

  it('returns moving when entity has velocity', () => {
    const e = makeEntity({ vx: 30, vy: 40 });
    expect(detectAnimState(e, 0)).toBe('moving');
  });

  it('returns idle when stationary and not hit', () => {
    const e = makeEntity({ vx: 0, vy: 0 });
    expect(detectAnimState(e, 0)).toBe('idle');
  });

  it('dying takes priority over hit', () => {
    const e = makeEntity({ state: STATE.DYING });
    expect(detectAnimState(e, 0.5)).toBe('dying');
  });
});

// ── Deformation layers ──

describe('Deformation layers', () => {
  it('wobble returns values near 1.0', () => {
    const config = { amp: 0.1, freq: 2.0, octaves: 2 };
    const val = wobble(0, 0, config, 0);
    expect(val).toBeGreaterThan(0.5);
    expect(val).toBeLessThan(1.5);
  });

  it('wobble varies by angle', () => {
    const config = { amp: 0.1, freq: 2.0, octaves: 2 };
    const v1 = wobble(0, 1.0, config, 0);
    const v2 = wobble(Math.PI, 1.0, config, 0);
    expect(v1).not.toBeCloseTo(v2, 3);
  });

  it('breathing returns values near 1.0', () => {
    const config = { amp: 0.05, freq: 1.0 };
    const val = breathing(0, config, 0);
    expect(val).toBeGreaterThan(0.9);
    expect(val).toBeLessThan(1.1);
  });

  it('squashStretch returns identity when stationary', () => {
    const ss = squashStretch(0, 0, { moveFactor: 0.15 });
    expect(ss.scaleX).toBe(1);
    expect(ss.scaleY).toBe(1);
    expect(ss.rotation).toBe(0);
  });

  it('squashStretch stretches along movement direction', () => {
    const ss = squashStretch(100, 0, { moveFactor: 0.15 });
    expect(ss.scaleX).toBeGreaterThan(1);
    expect(ss.scaleY).toBeLessThan(1);
    expect(ss.rotation).toBeCloseTo(0, 2);
  });

  it('hitReaction returns zero when no hit', () => {
    const hr = hitReaction(0, { flashDuration: 0.15, scalePulse: 0.2 });
    expect(hr.flash).toBe(0);
    expect(hr.scalePop).toBe(1);
  });

  it('hitReaction returns flash during hit', () => {
    const hr = hitReaction(0.1, { flashDuration: 0.15, scalePulse: 0.2 });
    expect(hr.flash).toBeGreaterThan(0);
    expect(hr.scalePop).toBeGreaterThan(1);
  });

  it('deathAnim splat expands and fades', () => {
    const d = deathAnim(0.2, { type: 'splat', duration: 0.4 });
    expect(d.progress).toBeCloseTo(0.5);
    expect(d.opacity).toBeLessThan(1);
    expect(d.scale).toBeGreaterThan(1);
  });

  it('deathAnim fade floats upward', () => {
    const d = deathAnim(0.25, { type: 'fade', duration: 0.5 });
    expect(d.yOffset).toBeLessThan(0); // negative = up
    expect(d.opacity).toBeLessThan(1);
  });

  it('deathAnim puff expands rapidly', () => {
    const d = deathAnim(0.17, { type: 'puff', duration: 0.35 });
    expect(d.scale).toBeGreaterThan(1);
    expect(d.scatter).toBeGreaterThan(0);
  });

  it('deathAnim crumble drops and scatters', () => {
    const d = deathAnim(0.3, { type: 'crumble', duration: 0.6 });
    expect(d.yOffset).toBeGreaterThan(0); // positive = down
    expect(d.scatter).toBeGreaterThan(0);
  });
});

// ── Deformation composition ──

describe('Deformation composition', () => {
  it('composes all layers into a transform descriptor', () => {
    const entity = makeEntity({ vx: 30, vy: 0 });
    const arch = ARCHETYPES.slime;
    const variation = buildVariation(arch, 1);
    const animState = { state: 'moving', hitTimer: 0, deathTimer: 0 };

    const d = composeDeformations(entity, 1.0, arch, variation, animState);

    expect(d.wobbleAt).toBeTypeOf('function');
    expect(d.scaleX).toBeTypeOf('number');
    expect(d.scaleY).toBeTypeOf('number');
    expect(d.opacity).toBeTypeOf('number');
    expect(d.flash).toBe(0);
    expect(d.isDying).toBe(false);
  });

  it('includes hit flash when hit', () => {
    const entity = makeEntity();
    const arch = ARCHETYPES.slime;
    const variation = buildVariation(arch, 1);
    const animState = { state: 'hit', hitTimer: 0.1, deathTimer: 0 };

    const d = composeDeformations(entity, 1.0, arch, variation, animState);
    expect(d.flash).toBeGreaterThan(0);
  });

  it('includes death data when dying', () => {
    const entity = makeEntity({ state: STATE.DYING });
    const arch = ARCHETYPES.slime;
    const variation = buildVariation(arch, 1);
    const animState = { state: 'dying', hitTimer: 0, deathTimer: 0.2 };

    const d = composeDeformations(entity, 1.0, arch, variation, animState);
    expect(d.isDying).toBe(true);
    expect(d.death).toBeDefined();
    expect(d.death.progress).toBeGreaterThan(0);
    expect(d.opacity).toBeLessThan(1);
  });
});

// ── Creature model resolver ──

describe('Creature model resolver', () => {
  let resolver;

  beforeEach(() => {
    resolver = createCreatureResolver();
  });

  it('resolves enemy entities into render models', () => {
    const e = makeEntity({ type: TYPE.ENEMY_BASIC });
    const model = resolver.resolve(e, 1.0, 1 / 60);

    expect(model).not.toBeNull();
    expect(model.archetype.id).toBe('slime');
    expect(model.x).toBe(e.x);
    expect(model.y).toBeCloseTo(e.y, 0);
    expect(model.radius).toBe(e.radius);
    expect(model.deform).toBeDefined();
    expect(model.variation).toBeDefined();
  });

  it('returns null for non-enemy types', () => {
    const player = makeEntity({ type: TYPE.PLAYER });
    expect(resolver.resolve(player, 1.0, 1 / 60)).toBeNull();

    const proj = makeEntity({ type: TYPE.PROJECTILE_BULLET });
    expect(resolver.resolve(proj, 1.0, 1 / 60)).toBeNull();
  });

  it('resolves all enemy types to their correct archetypes', () => {
    const types = [
      [TYPE.ENEMY_BASIC, 'slime'],
      [TYPE.ENEMY_FAST, 'ghost'],
      [TYPE.ENEMY_TANK, 'brute'],
      [TYPE.ENEMY_RANGED, 'ember'],
    ];

    for (const [type, expectedId] of types) {
      const e = makeEntity({ type, id: type * 10 });
      const model = resolver.resolve(e, 1.0, 1 / 60);
      expect(model.archetype.id).toBe(expectedId);
    }
  });

  it('caches variation per entity ID', () => {
    const e = makeEntity({ id: 42 });
    const m1 = resolver.resolve(e, 1.0, 1 / 60);
    const m2 = resolver.resolve(e, 2.0, 1 / 60);
    expect(m1.variation).toBe(m2.variation); // same reference
  });

  it('detects damage and triggers hit state', () => {
    const e = makeEntity({ id: 5, hp: 30, maxHp: 30 });

    // First frame — no damage
    const m1 = resolver.resolve(e, 1.0, 1 / 60);
    expect(m1.deform.flash).toBe(0);

    // Simulate damage
    e.hp = 20;
    const m2 = resolver.resolve(e, 1.0 + 1 / 60, 1 / 60);
    expect(m2.deform.flash).toBeGreaterThan(0);
  });

  it('tracks death timer progression', () => {
    const e = makeEntity({ id: 7, state: STATE.DYING });
    const m1 = resolver.resolve(e, 1.0, 1 / 60);
    const m2 = resolver.resolve(e, 1.0 + 5 / 60, 5 / 60);

    expect(m1.deform.isDying).toBe(true);
    expect(m2.deform.isDying).toBe(true);
    expect(m2.deform.death.progress).toBeGreaterThan(m1.deform.death.progress);
  });

  it('uses entity facing when available', () => {
    const e = makeEntity({ facing: 1.5 });
    const model = resolver.resolve(e, 1.0, 1 / 60);
    expect(model.facing).toBe(1.5);
  });

  it('falls back to velocity angle when facing is 0', () => {
    const e = makeEntity({ facing: 0, vx: 1, vy: 1 });
    const model = resolver.resolve(e, 1.0, 1 / 60);
    expect(model.facing).toBeCloseTo(Math.PI / 4, 2);
  });

  it('reset clears all caches', () => {
    const e = makeEntity({ id: 42 });
    const m1 = resolver.resolve(e, 1.0, 1 / 60);
    resolver.reset();
    const m2 = resolver.resolve(e, 1.0, 1 / 60);
    // Variation should be equal but not the same reference (re-created)
    expect(m1.variation).not.toBe(m2.variation);
    expect(m1.variation.hueShift).toBe(m2.variation.hueShift);
  });

  it('prune removes stale entries', () => {
    // Resolve several entities
    for (let i = 0; i < 20; i++) {
      resolver.resolve(makeEntity({ id: i, type: TYPE.ENEMY_BASIC }), 1.0, 1 / 60);
    }

    // Prune with only 5 active
    const active = new Set([0, 1, 2, 3, 4]);
    resolver.prune(active);

    // Resolving a pruned entity should still work (re-creates cache)
    const model = resolver.resolve(makeEntity({ id: 15, type: TYPE.ENEMY_BASIC }), 1.0, 1 / 60);
    expect(model).not.toBeNull();
  });
});
