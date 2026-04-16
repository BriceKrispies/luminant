/**
 * Visual progression system for creatures.
 *
 * Derives a stable, bounded visual progression state from entity level,
 * XP progress, time, and seeded per-entity variation. Entirely renderer-side.
 *
 * Design principles:
 *   - Finite milestone unlocks for major visual features
 *   - Infinite modulation for motion, pulse, phase, hue/temperature drift
 *   - Bounded intensity — brightness, element count, silhouette never grow unbounded
 *   - Data-driven config per archetype
 *   - Zero allocations after warmup (reuses state objects)
 *
 * Progression model:
 *   tier        — integer milestone tier (0 = base, caps at config.milestones.length)
 *   intensity   — 0-1 bounded overall progression strength
 *   xpPhase     — 0-1 progress within current level (for sub-level smoothing)
 *   modPhase    — infinite time-varying modulation phase (wraps, never grows)
 *   features    — unlocked feature flags (glow, tendrils, halo, crown, burst)
 *   derived     — per-feature computed params (glowStrength, tendrilCount, haloStage, etc.)
 */

const TAU = Math.PI * 2;

// ── Default progression config (player) ──

export const PLAYER_PROGRESSION = {
  milestones: [
    { level: 1,  label: 'Awakened',     unlocks: [] },
    { level: 3,  label: 'Faint Glow',   unlocks: ['glow'] },
    { level: 6,  label: 'First Wisp',   unlocks: ['tendrils'] },
    { level: 10, label: 'Inner Light',   unlocks: ['glow_pulse'] },
    { level: 15, label: 'Halo Ring',     unlocks: ['halo'] },
    { level: 22, label: 'Energy Flow',   unlocks: ['tendril_motion'] },
    { level: 30, label: 'Crown Form',    unlocks: ['crown'] },
    { level: 40, label: 'Radiant',       unlocks: ['second_order'] },
    { level: 50, label: 'Ascended',      unlocks: ['ascended'] },
  ],

  // Intensity curve: maps level → 0-1 bounded intensity
  // Uses asymptotic curve: intensity = 1 - e^(-level / scale)
  intensityScale: 25,
  intensityMax: 1.0,

  // Glow
  glowMinAlpha: 0.0,
  glowMaxAlpha: 0.35,
  glowMinRadius: 0,
  glowMaxRadius: 4,
  glowPulseFreq: 0.8,
  glowPulseAmp: 0.12,

  // Tendrils
  tendrilMinCount: 0,
  tendrilMaxCount: 6,
  tendrilMinLength: 0,
  tendrilMaxLength: 12,
  tendrilMinAlpha: 0,
  tendrilMaxAlpha: 0.6,
  tendrilWaveFreq: 1.5,
  tendrilWaveAmp: 3.0,
  tendrilMotionFreq: 0.6,

  // Halo
  haloStages: 3,          // 0=none, 1=ring, 2=double ring, 3=crown points
  haloMinAlpha: 0,
  haloMaxAlpha: 0.6,
  haloRadius: 6,
  haloRotateFreq: 0.15,

  // Crown (halo stage 3)
  crownPoints: 3,
  crownPointHeight: 3,

  // Modulation (infinite, bounded)
  modFreqBase: 0.3,       // base modulation frequency
  modFreqVariance: 0.1,   // per-entity variation
  hueShiftMax: 0.04,      // subtle warm/cool drift
  temperatureFreq: 0.05,  // very slow temperature oscillation

  // Level-up burst
  burstDuration: 0.6,
  burstMaxRadius: 18,
  burstMaxAlpha: 0.8,
  burstParticleCount: 8,
};

// ── Default config for non-player archetypes ──

export const DEFAULT_PROGRESSION = {
  milestones: [
    { level: 1,  label: 'Base',     unlocks: [] },
    { level: 5,  label: 'Glow',     unlocks: ['glow'] },
    { level: 15, label: 'Pulse',    unlocks: ['glow_pulse'] },
    { level: 30, label: 'Radiant',  unlocks: ['second_order'] },
  ],
  intensityScale: 30,
  intensityMax: 0.6,    // weaker than player
  glowMinAlpha: 0.0,
  glowMaxAlpha: 0.2,
  glowMinRadius: 0,
  glowMaxRadius: 3,
  glowPulseFreq: 0.6,
  glowPulseAmp: 0.08,
  tendrilMinCount: 0,
  tendrilMaxCount: 0,    // no tendrils by default
  tendrilMinLength: 0,
  tendrilMaxLength: 0,
  tendrilMinAlpha: 0,
  tendrilMaxAlpha: 0,
  tendrilWaveFreq: 0,
  tendrilWaveAmp: 0,
  tendrilMotionFreq: 0,
  haloStages: 0,
  haloMinAlpha: 0,
  haloMaxAlpha: 0,
  haloRadius: 0,
  haloRotateFreq: 0,
  crownPoints: 0,
  crownPointHeight: 0,
  modFreqBase: 0.2,
  modFreqVariance: 0.08,
  hueShiftMax: 0.02,
  temperatureFreq: 0.04,
  burstDuration: 0.5,
  burstMaxRadius: 14,
  burstMaxAlpha: 0.6,
  burstParticleCount: 6,
};

// ── Per-archetype config registry ──

const progressionConfigs = new Map();
progressionConfigs.set('player', PLAYER_PROGRESSION);

/**
 * Register a custom progression config for an archetype.
 */
export function registerProgressionConfig(archetypeId, config) {
  progressionConfigs.set(archetypeId, config);
}

/**
 * Get progression config for an archetype (falls back to DEFAULT_PROGRESSION).
 */
export function getProgressionConfig(archetypeId) {
  return progressionConfigs.get(archetypeId) || DEFAULT_PROGRESSION;
}

// ── Progression state computation ──

/**
 * Compute the current progression tier for a given level.
 * Returns the index of the highest milestone whose level <= entityLevel.
 */
export function computeTier(milestones, level) {
  let tier = 0;
  for (let i = 0; i < milestones.length; i++) {
    if (level >= milestones[i].level) tier = i;
    else break;
  }
  return tier;
}

/**
 * Compute bounded intensity from level using asymptotic curve.
 * intensity = max * (1 - e^(-level / scale))
 */
export function computeIntensity(level, scale, max) {
  return max * (1 - Math.exp(-level / scale));
}

/**
 * Collect all unlocked feature flags up to a given tier.
 */
export function collectUnlockedFeatures(milestones, tier) {
  const features = new Set();
  for (let i = 0; i <= tier && i < milestones.length; i++) {
    for (const f of milestones[i].unlocks) {
      features.add(f);
    }
  }
  return features;
}

/**
 * Compute the infinite modulation phase (wrapping, never grows unbounded).
 * Returns a value in [0, TAU) that cycles smoothly.
 */
export function computeModPhase(time, freq, entityPhase) {
  return ((time * freq + entityPhase) % TAU + TAU) % TAU;
}

/**
 * Linear interpolation helper.
 */
function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/**
 * Derive full progression state for an entity.
 *
 * @param {object} params
 * @param {string} params.archetypeId - Archetype identifier
 * @param {number} params.level - Entity level (1+)
 * @param {number} params.time - Current game time (seconds)
 * @param {number} [params.xpProgress=0] - 0-1 progress within current level
 * @param {number} [params.entitySeed=0] - Per-entity variation seed (0-1)
 * @param {object} [params.config] - Override progression config
 * @returns {object} Progression state
 */
export function deriveProgressionState(params) {
  const {
    archetypeId = 'player',
    level = 1,
    time = 0,
    xpProgress = 0,
    entitySeed = 0,
    config: configOverride,
  } = params;

  const config = configOverride || getProgressionConfig(archetypeId);
  const ms = config.milestones;

  // Core values
  const tier = computeTier(ms, level);
  const intensity = computeIntensity(level, config.intensityScale, config.intensityMax);
  const features = collectUnlockedFeatures(ms, tier);

  // Per-entity modulation
  const entityPhase = entitySeed * TAU;
  const modFreq = config.modFreqBase + entitySeed * config.modFreqVariance;
  const modPhase = computeModPhase(time, modFreq, entityPhase);

  // Sub-level smoothing: blend toward next tier
  const smoothLevel = level + xpProgress;
  const smoothIntensity = computeIntensity(smoothLevel, config.intensityScale, config.intensityMax);

  // ── Derived feature params ──

  // Glow
  const hasGlow = features.has('glow');
  const hasGlowPulse = features.has('glow_pulse');
  const glowBase = hasGlow ? lerp(config.glowMinAlpha, config.glowMaxAlpha, smoothIntensity) : 0;
  const glowPulse = hasGlowPulse
    ? Math.sin(time * config.glowPulseFreq * TAU + entityPhase) * config.glowPulseAmp * smoothIntensity
    : 0;
  const glowStrength = Math.max(0, Math.min(config.glowMaxAlpha, glowBase + glowPulse));
  const glowRadius = hasGlow ? lerp(config.glowMinRadius, config.glowMaxRadius, smoothIntensity) : 0;

  // Tendrils
  const hasTendrils = features.has('tendrils');
  const hasTendrilMotion = features.has('tendril_motion');
  const tendrilCount = hasTendrils
    ? Math.round(lerp(config.tendrilMinCount, config.tendrilMaxCount, smoothIntensity))
    : 0;
  const tendrilLength = hasTendrils
    ? lerp(config.tendrilMinLength, config.tendrilMaxLength, smoothIntensity)
    : 0;
  const tendrilAlpha = hasTendrils
    ? lerp(config.tendrilMinAlpha, config.tendrilMaxAlpha, smoothIntensity)
    : 0;
  const tendrilPhase = hasTendrilMotion
    ? computeModPhase(time, config.tendrilMotionFreq, entityPhase * 1.3)
    : 0;

  // Halo
  const hasHalo = features.has('halo');
  const hasCrown = features.has('crown');
  let haloStage = 0;
  if (hasHalo) haloStage = 1;
  if (hasHalo && smoothIntensity > 0.65) haloStage = 2;
  if (hasCrown) haloStage = 3;
  const haloAlpha = hasHalo
    ? lerp(config.haloMinAlpha, config.haloMaxAlpha, smoothIntensity)
    : 0;
  const haloRotation = hasHalo
    ? computeModPhase(time, config.haloRotateFreq, entityPhase * 0.7)
    : 0;

  // Second-order motion (enriches existing modulation)
  const hasSecondOrder = features.has('second_order');
  const secondOrderAmp = hasSecondOrder ? smoothIntensity * 0.5 : 0;

  // Ascended (final tier — subtle extra shimmer)
  const hasAscended = features.has('ascended');
  const ascendedShimmer = hasAscended
    ? 0.5 + 0.5 * Math.sin(time * 2.3 + entityPhase * 1.7)
    : 0;

  // Temperature / hue drift (infinite, bounded)
  const hueShift = Math.sin(time * config.temperatureFreq * TAU + entityPhase * 2.1)
    * config.hueShiftMax * smoothIntensity;

  return {
    // Core
    tier,
    tierLabel: ms[tier] ? ms[tier].label : 'Base',
    level,
    intensity: smoothIntensity,
    xpPhase: xpProgress,
    modPhase,
    features,

    // Derived
    glowStrength,
    glowRadius,
    tendrilCount,
    tendrilLength,
    tendrilAlpha,
    tendrilPhase,
    haloStage,
    haloAlpha,
    haloRotation,
    haloRadius: config.haloRadius,
    crownPoints: config.crownPoints,
    crownPointHeight: config.crownPointHeight,
    secondOrderAmp,
    ascendedShimmer,
    hueShift,

    // Config refs (for drawing)
    tendrilWaveFreq: config.tendrilWaveFreq,
    tendrilWaveAmp: config.tendrilWaveAmp,

    // Burst config
    burstDuration: config.burstDuration,
    burstMaxRadius: config.burstMaxRadius,
    burstMaxAlpha: config.burstMaxAlpha,
    burstParticleCount: config.burstParticleCount,
  };
}

// ── Level-up burst state ──

/**
 * Create a burst state tracker for level-up effects.
 * Call trigger() on level-up, update(dt) each frame.
 */
export function createBurstState() {
  let timer = 0;
  let duration = 0;
  let active = false;

  return {
    get active() { return active; },
    get progress() { return active ? Math.min(timer / duration, 1) : 0; },
    get timer() { return timer; },

    trigger(burstDuration = 0.6) {
      timer = 0;
      duration = burstDuration;
      active = true;
    },

    update(dt) {
      if (!active) return;
      timer += dt;
      if (timer >= duration) {
        active = false;
        timer = 0;
      }
    },

    reset() {
      timer = 0;
      active = false;
    },
  };
}

// ── Formatting helpers (for studio/debug) ──

/**
 * Format progression state as a compact debug summary.
 */
export function formatProgressionDebug(state) {
  if (!state) return 'No progression';

  const featureList = state.features.size > 0
    ? [...state.features].join(', ')
    : 'none';

  return [
    `Tier ${state.tier}: ${state.tierLabel}`,
    `Level: ${state.level} | Intensity: ${state.intensity.toFixed(3)}`,
    `Glow: ${state.glowStrength.toFixed(3)} (r=${state.glowRadius.toFixed(1)})`,
    `Tendrils: ${state.tendrilCount} (len=${state.tendrilLength.toFixed(1)}, a=${state.tendrilAlpha.toFixed(2)})`,
    `Halo: stage ${state.haloStage} (a=${state.haloAlpha.toFixed(2)})`,
    `Mod: phase=${state.modPhase.toFixed(2)} hue=${state.hueShift.toFixed(4)}`,
    `2nd order: ${state.secondOrderAmp.toFixed(3)} | Ascended: ${state.ascendedShimmer.toFixed(2)}`,
    `Features: ${featureList}`,
  ].join('\n');
}
