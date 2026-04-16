/**
 * Tests for the visual progression system.
 *
 * Covers: deterministic state derivation, bounded intensity, milestone unlocks,
 * no unbounded element growth, burst state, debug formatting.
 */

import { describe, it, expect } from 'vitest';
import {
  PLAYER_PROGRESSION,
  DEFAULT_PROGRESSION,
  computeTier,
  computeIntensity,
  collectUnlockedFeatures,
  computeModPhase,
  deriveProgressionState,
  createBurstState,
  formatProgressionDebug,
  getProgressionConfig,
  registerProgressionConfig,
} from '../src/renderer/creatures/progression.js';

const TAU = Math.PI * 2;

// ── Tier computation ──

describe('computeTier', () => {
  const ms = PLAYER_PROGRESSION.milestones;

  it('returns 0 for level 1', () => {
    expect(computeTier(ms, 1)).toBe(0);
  });

  it('returns 0 for level 2 (below first unlock)', () => {
    expect(computeTier(ms, 2)).toBe(0);
  });

  it('returns correct tier at milestone boundaries', () => {
    expect(computeTier(ms, 3)).toBe(1);   // Faint Glow
    expect(computeTier(ms, 6)).toBe(2);   // First Wisp
    expect(computeTier(ms, 10)).toBe(3);  // Inner Light
    expect(computeTier(ms, 15)).toBe(4);  // Halo Ring
    expect(computeTier(ms, 30)).toBe(6);  // Crown Form
    expect(computeTier(ms, 50)).toBe(8);  // Ascended
  });

  it('returns correct tier between milestones', () => {
    expect(computeTier(ms, 8)).toBe(2);   // between 6 and 10
    expect(computeTier(ms, 25)).toBe(5);  // between 22 and 30
  });

  it('caps at last tier for very high levels', () => {
    expect(computeTier(ms, 100)).toBe(8);
    expect(computeTier(ms, 999)).toBe(8);
  });
});

// ── Intensity computation ──

describe('computeIntensity', () => {
  it('returns 0 for level 0', () => {
    expect(computeIntensity(0, 25, 1.0)).toBeCloseTo(0, 3);
  });

  it('returns bounded value for level 1', () => {
    const v = computeIntensity(1, 25, 1.0);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(0.1);
  });

  it('approaches max asymptotically', () => {
    const v50 = computeIntensity(50, 25, 1.0);
    const v100 = computeIntensity(100, 25, 1.0);
    expect(v50).toBeGreaterThan(0.8);
    expect(v100).toBeGreaterThan(0.95);
    expect(v100).toBeLessThanOrEqual(1.0);
  });

  it('never exceeds max', () => {
    for (let level = 0; level <= 200; level++) {
      expect(computeIntensity(level, 25, 1.0)).toBeLessThanOrEqual(1.0);
    }
  });

  it('respects max parameter', () => {
    const v = computeIntensity(50, 25, 0.6);
    expect(v).toBeLessThanOrEqual(0.6);
  });
});

// ── Feature unlocks ──

describe('collectUnlockedFeatures', () => {
  const ms = PLAYER_PROGRESSION.milestones;

  it('returns empty set at tier 0', () => {
    const f = collectUnlockedFeatures(ms, 0);
    expect(f.size).toBe(0);
  });

  it('unlocks glow at tier 1', () => {
    const f = collectUnlockedFeatures(ms, 1);
    expect(f.has('glow')).toBe(true);
    expect(f.has('tendrils')).toBe(false);
  });

  it('accumulates features across tiers', () => {
    const f = collectUnlockedFeatures(ms, 4);
    expect(f.has('glow')).toBe(true);
    expect(f.has('tendrils')).toBe(true);
    expect(f.has('glow_pulse')).toBe(true);
    expect(f.has('halo')).toBe(true);
    expect(f.has('crown')).toBe(false);
  });

  it('has all features at max tier', () => {
    const f = collectUnlockedFeatures(ms, ms.length - 1);
    expect(f.has('glow')).toBe(true);
    expect(f.has('tendrils')).toBe(true);
    expect(f.has('halo')).toBe(true);
    expect(f.has('crown')).toBe(true);
    expect(f.has('ascended')).toBe(true);
  });
});

// ── Modulation phase ──

describe('computeModPhase', () => {
  it('returns a value in [0, TAU)', () => {
    for (let t = 0; t < 100; t += 0.7) {
      const phase = computeModPhase(t, 0.3, 0.5);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(TAU);
    }
  });

  it('wraps correctly — never grows unbounded', () => {
    const p1 = computeModPhase(1000000, 0.3, 0);
    expect(p1).toBeGreaterThanOrEqual(0);
    expect(p1).toBeLessThan(TAU);
  });
});

// ── Full progression state ──

describe('deriveProgressionState', () => {
  it('returns deterministic state for same inputs', () => {
    const params = { archetypeId: 'player', level: 20, time: 5, entitySeed: 0.3 };
    const a = deriveProgressionState(params);
    const b = deriveProgressionState(params);
    expect(a.tier).toBe(b.tier);
    expect(a.intensity).toBe(b.intensity);
    expect(a.glowStrength).toBe(b.glowStrength);
    expect(a.tendrilCount).toBe(b.tendrilCount);
    expect(a.haloStage).toBe(b.haloStage);
  });

  it('level 1 player has minimal visuals', () => {
    const s = deriveProgressionState({ archetypeId: 'player', level: 1, time: 0 });
    expect(s.tier).toBe(0);
    expect(s.glowStrength).toBe(0);
    expect(s.tendrilCount).toBe(0);
    expect(s.haloStage).toBe(0);
  });

  it('level 10 player has glow and tendrils', () => {
    const s = deriveProgressionState({ archetypeId: 'player', level: 10, time: 0 });
    expect(s.features.has('glow')).toBe(true);
    expect(s.features.has('tendrils')).toBe(true);
    expect(s.features.has('glow_pulse')).toBe(true);
    expect(s.glowStrength).toBeGreaterThan(0);
    expect(s.tendrilCount).toBeGreaterThan(0);
  });

  it('level 30 player has halo and crown', () => {
    const s = deriveProgressionState({ archetypeId: 'player', level: 30, time: 0 });
    expect(s.features.has('halo')).toBe(true);
    expect(s.features.has('crown')).toBe(true);
    expect(s.haloStage).toBe(3);
  });

  it('level 50 player has all features', () => {
    const s = deriveProgressionState({ archetypeId: 'player', level: 50, time: 0 });
    expect(s.features.has('ascended')).toBe(true);
    expect(s.features.has('second_order')).toBe(true);
  });

  it('intensity never exceeds max at extreme levels', () => {
    for (const level of [1, 10, 50, 100, 500, 1000]) {
      const s = deriveProgressionState({ archetypeId: 'player', level, time: 0 });
      expect(s.intensity).toBeLessThanOrEqual(PLAYER_PROGRESSION.intensityMax);
    }
  });

  it('tendril count is bounded', () => {
    for (const level of [1, 10, 50, 100, 500]) {
      const s = deriveProgressionState({ archetypeId: 'player', level, time: 0 });
      expect(s.tendrilCount).toBeLessThanOrEqual(PLAYER_PROGRESSION.tendrilMaxCount);
      expect(s.tendrilLength).toBeLessThanOrEqual(PLAYER_PROGRESSION.tendrilMaxLength);
      expect(s.tendrilAlpha).toBeLessThanOrEqual(PLAYER_PROGRESSION.tendrilMaxAlpha);
    }
  });

  it('glow strength is bounded', () => {
    for (const level of [1, 10, 50, 100, 500]) {
      const s = deriveProgressionState({ archetypeId: 'player', level, time: 0 });
      expect(s.glowStrength).toBeLessThanOrEqual(PLAYER_PROGRESSION.glowMaxAlpha);
    }
  });

  it('halo stage is bounded', () => {
    for (const level of [1, 10, 50, 100, 500]) {
      const s = deriveProgressionState({ archetypeId: 'player', level, time: 0 });
      expect(s.haloStage).toBeLessThanOrEqual(PLAYER_PROGRESSION.haloStages);
    }
  });

  it('uses default config for unknown archetypes', () => {
    const s = deriveProgressionState({ archetypeId: 'unknown_thing', level: 20, time: 0 });
    expect(s.tier).toBeGreaterThan(0);
    expect(s.intensity).toBeLessThanOrEqual(DEFAULT_PROGRESSION.intensityMax);
  });

  it('non-player archetypes get default progression', () => {
    const s = deriveProgressionState({ archetypeId: 'slime', level: 20, time: 0 });
    expect(s.tendrilCount).toBe(0); // default has no tendrils
    expect(s.haloStage).toBe(0);   // default has no halo
  });

  it('xpProgress smooths intensity between levels', () => {
    const a = deriveProgressionState({ archetypeId: 'player', level: 10, time: 0, xpProgress: 0 });
    const b = deriveProgressionState({ archetypeId: 'player', level: 10, time: 0, xpProgress: 0.5 });
    const c = deriveProgressionState({ archetypeId: 'player', level: 10, time: 0, xpProgress: 1.0 });
    expect(b.intensity).toBeGreaterThan(a.intensity);
    expect(c.intensity).toBeGreaterThan(b.intensity);
  });

  it('different entity seeds produce different modulation', () => {
    const a = deriveProgressionState({ archetypeId: 'player', level: 20, time: 5, entitySeed: 0.1 });
    const b = deriveProgressionState({ archetypeId: 'player', level: 20, time: 5, entitySeed: 0.7 });
    expect(a.modPhase).not.toBe(b.modPhase);
  });
});

// ── Burst state ──

describe('createBurstState', () => {
  it('starts inactive', () => {
    const b = createBurstState();
    expect(b.active).toBe(false);
    expect(b.progress).toBe(0);
  });

  it('becomes active after trigger', () => {
    const b = createBurstState();
    b.trigger(0.5);
    expect(b.active).toBe(true);
  });

  it('progress advances with update', () => {
    const b = createBurstState();
    b.trigger(1.0);
    b.update(0.3);
    expect(b.progress).toBeCloseTo(0.3, 2);
  });

  it('deactivates when duration elapsed', () => {
    const b = createBurstState();
    b.trigger(0.5);
    b.update(0.6);
    expect(b.active).toBe(false);
  });

  it('reset clears state', () => {
    const b = createBurstState();
    b.trigger(1.0);
    b.update(0.2);
    b.reset();
    expect(b.active).toBe(false);
    expect(b.progress).toBe(0);
  });
});

// ── Config registry ──

describe('progression config', () => {
  it('returns player config for player', () => {
    expect(getProgressionConfig('player')).toBe(PLAYER_PROGRESSION);
  });

  it('returns default for unregistered archetypes', () => {
    expect(getProgressionConfig('something_random')).toBe(DEFAULT_PROGRESSION);
  });

  it('allows registering custom configs', () => {
    const custom = { ...DEFAULT_PROGRESSION, intensityMax: 0.99 };
    registerProgressionConfig('test_type', custom);
    expect(getProgressionConfig('test_type')).toBe(custom);
  });
});

// ── Debug formatting ──

describe('formatProgressionDebug', () => {
  it('returns string for null', () => {
    expect(formatProgressionDebug(null)).toBe('No progression');
  });

  it('formats progression state as multiline string', () => {
    const s = deriveProgressionState({ archetypeId: 'player', level: 20, time: 5 });
    const text = formatProgressionDebug(s);
    expect(text).toContain('Tier');
    expect(text).toContain('Level: 20');
    expect(text).toContain('Glow:');
    expect(text).toContain('Tendrils:');
    expect(text).toContain('Halo:');
    expect(text).toContain('Features:');
  });
});
