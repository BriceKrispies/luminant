/**
 * Visual archetype definitions for procedural creatures.
 *
 * Each archetype defines:
 *   - Body parts (main body, eyes, appendages, extras)
 *   - Color palette (base, highlight, glow, eye)
 *   - Deformation parameters (which layers apply, amplitude)
 *   - Shape drawing hints (used by Canvas 2D draw layer)
 *   - Variation ranges (per-entity seeded randomization)
 *
 * Archetypes are pure data — no drawing code lives here.
 */

import { TYPE } from '../../engine/bindings.js';

// ── Archetype definitions ──

export const ARCHETYPES = {
  slime: {
    id: 'slime',
    name: 'Slime',
    skeletonId: 'slime',
    secondaryId: 'slime',
    expressionId: 'slime',
    // Body: blobby, jiggly mass
    body: {
      shape: 'blob',        // drawn as deformed circle with wobble
      aspectRatio: 1.1,     // slightly wider than tall
      segments: 12,         // number of perimeter points for blob outline
    },
    // Eyes: two dots that track velocity direction
    eyes: {
      count: 2,
      size: 0.18,           // relative to radius
      offset: 0.3,          // distance from center (relative to radius)
      spread: 0.5,          // angular spread between eyes (radians)
      style: 'dot',         // solid circle
    },
    // Color palette
    palette: {
      base: [0.26, 0.67, 0.53],     // #44aa88-ish teal-green
      highlight: [0.4, 0.85, 0.65],  // lighter variant
      glow: [0.2, 0.6, 0.45, 0.4],  // glow color with alpha
      eye: [0.1, 0.1, 0.12],        // dark eyes
      interior: [0.15, 0.45, 0.35],  // darker interior shading
    },
    // Deformation config
    deform: {
      wobble: { amp: 0.12, freq: 2.5, octaves: 2 },
      breathing: { amp: 0.06, freq: 1.2 },
      squashStretch: { moveFactor: 0.15 },
      hit: { flashDuration: 0.15, scalePulse: 0.2 },
      death: { type: 'splat', duration: 0.4 },
    },
    // Seeded variation ranges
    variation: {
      hueShift: [-0.08, 0.08],      // subtle hue variation
      scaleJitter: [0.9, 1.1],       // size variation
      wobblePhase: [0, 6.28],        // random wobble phase offset
      eyeSizeJitter: [0.8, 1.2],
    },
  },

  ghost: {
    id: 'ghost',
    name: 'Ghost',
    skeletonId: 'ghost',
    secondaryId: 'ghost',
    expressionId: 'ghost',
    body: {
      shape: 'wisp',        // spectral wraith silhouette with ragged trailing cloak
      aspectRatio: 0.75,    // taller than wide, forward-leaning
      segments: 16,
      tailWaves: 5,         // ragged trailing strips
      tailLength: 0.8,      // long trailing cloak
    },
    eyes: {
      count: 2,
      size: 0.1,            // small, subtle
      offset: 0.1,
      spread: 0.35,
      style: 'glow',        // dim spectral glow
    },
    palette: {
      base: [0.38, 0.22, 0.52],     // deeper purple
      highlight: [0.62, 0.45, 0.75], // lighter lavender for contrast
      glow: [0.3, 0.12, 0.45, 0.25], // muted purple underglow
      eye: [0.55, 0.35, 0.75],      // dim violet inner glow
      interior: [0.15, 0.06, 0.22], // very dark void purple
    },
    deform: {
      wobble: { amp: 0.08, freq: 1.8, octaves: 3 },
      breathing: { amp: 0.04, freq: 0.8 },
      squashStretch: { moveFactor: 0.08 },
      hit: { flashDuration: 0.12, scalePulse: 0.15 },
      death: { type: 'fade', duration: 0.5 },
    },
    variation: {
      hueShift: [-0.04, 0.04],
      scaleJitter: [0.85, 1.15],
      wobblePhase: [0, 6.28],
      tailWaveOffset: [0, 6.28],
      opacity: [0.8, 0.95],         // spectral but fairly solid
    },
  },

  ember: {
    id: 'ember',
    name: 'Ember',
    skeletonId: 'ember',
    secondaryId: 'ember',
    expressionId: 'ember',
    body: {
      shape: 'flame',       // flickering teardrop
      aspectRatio: 0.8,     // tall
      segments: 10,
      flickerPoints: 4,     // number of flame tips
    },
    eyes: {
      count: 2,
      size: 0.15,
      offset: 0.2,
      spread: 0.4,
      style: 'slit',        // vertical slit pupils
    },
    palette: {
      base: [0.9, 0.75, 0.2],       // golden yellow
      highlight: [1.0, 0.95, 0.6],  // bright core
      glow: [0.95, 0.6, 0.1, 0.5],  // warm glow
      eye: [0.2, 0.05, 0.0],        // dark slits
      interior: [1.0, 0.5, 0.1],    // hot orange interior
    },
    deform: {
      wobble: { amp: 0.18, freq: 4.0, octaves: 3 },  // high-freq flicker
      breathing: { amp: 0.08, freq: 2.0 },
      squashStretch: { moveFactor: 0.2 },
      hit: { flashDuration: 0.1, scalePulse: 0.3 },
      death: { type: 'puff', duration: 0.35 },
    },
    variation: {
      hueShift: [-0.1, 0.1],
      scaleJitter: [0.85, 1.15],
      wobblePhase: [0, 6.28],
      flickerSpeed: [0.8, 1.3],
    },
  },

  player: {
    id: 'player',
    name: 'Player',
    skeletonId: 'player',
    secondaryId: null,
    expressionId: 'player',
    body: {
      shape: 'hero',
      aspectRatio: 0.9,
      segments: 10,
    },
    eyes: {
      count: 2,
      size: 0.14,
      offset: 0.25,
      spread: 0.4,
      style: 'dot',
    },
    palette: {
      base: [0.95, 0.82, 0.45],       // golden
      highlight: [1.0, 0.95, 0.7],    // bright gold
      glow: [1.0, 0.85, 0.4, 0.4],   // warm glow
      eye: [0.15, 0.12, 0.08],       // dark eyes
      interior: [0.75, 0.55, 0.25],   // deeper gold
    },
    deform: {
      wobble: { amp: 0.04, freq: 2.0, octaves: 1 },
      breathing: { amp: 0.04, freq: 1.0 },
      squashStretch: { moveFactor: 0.1 },
      hit: { flashDuration: 0.15, scalePulse: 0.15 },
      death: { type: 'fade', duration: 0.5 },
    },
    variation: {
      hueShift: [0, 0],
      scaleJitter: [1, 1],
      wobblePhase: [0, 6.28],
    },
  },

  brute: {
    id: 'brute',
    name: 'Brute',
    skeletonId: 'brute',
    secondaryId: 'brute',
    expressionId: 'brute',
    body: {
      shape: 'homunculus',   // hunched, oversized arms, small head
      aspectRatio: 1.3,      // wider than tall
      segments: 8,
    },
    eyes: {
      count: 2,
      size: 0.11,            // smaller — beady eyes on tiny head
      offset: 0.2,
      spread: 0.25,
      style: 'angry',        // angled brow marks above eyes
    },
    palette: {
      base: [0.6, 0.3, 0.85],       // purple
      highlight: [0.75, 0.45, 1.0],
      glow: [0.55, 0.25, 0.8, 0.5],
      eye: [1.0, 0.3, 0.2],         // angry red eyes
      interior: [0.4, 0.18, 0.6],
    },
    deform: {
      wobble: { amp: 0.03, freq: 1.2, octaves: 1 },  // minimal — solid mass
      breathing: { amp: 0.02, freq: 0.5 },
      squashStretch: { moveFactor: 0.04 },
      hit: { flashDuration: 0.2, scalePulse: 0.1 },
      death: { type: 'crumble', duration: 0.6 },
    },
    variation: {
      hueShift: [-0.05, 0.05],
      scaleJitter: [0.95, 1.05],
      wobblePhase: [0, 6.28],
    },
  },
};

// ── Entity type → archetype mapping ──

export const TYPE_TO_ARCHETYPE = {
  [TYPE.PLAYER]: 'player',
  [TYPE.ENEMY_BASIC]: 'slime',
  [TYPE.ENEMY_FAST]: 'ghost',
  [TYPE.ENEMY_TANK]: 'brute',
  [TYPE.ENEMY_SHOOTER]: 'ember',
  // New behavior types reuse existing archetypes for a minimum-art baseline.
  [TYPE.ENEMY_ORBITER]: 'ghost',
  [TYPE.ENEMY_KITER]: 'ember',
  [TYPE.ENEMY_CHARGER]: 'brute',
  [TYPE.ENEMY_FLANKER]: 'ghost',
  [TYPE.ENEMY_ZIGZAG]: 'slime',
  [TYPE.ENEMY_AMBUSHER]: 'ghost',
  [TYPE.ENEMY_RETREATER]: 'slime',
  [TYPE.ENEMY_SUMMONER]: 'brute',
};

/**
 * Get the archetype for an entity type.
 * Returns null for non-enemy types (player, projectiles, pickups).
 */
export function getArchetype(entityType) {
  const id = TYPE_TO_ARCHETYPE[entityType];
  return id ? ARCHETYPES[id] : null;
}

/**
 * Simple seeded PRNG for per-entity variation.
 * Returns a function that produces deterministic [0,1) values from an entity ID seed.
 */
export function seededRandom(entityId) {
  let s = entityId * 2654435761 >>> 0; // Knuth multiplicative hash
  return () => {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Sample a variation value from a range using a seeded random.
 */
export function sampleVariation(rng, range) {
  if (!range) return 0;
  const [min, max] = range;
  return min + rng() * (max - min);
}

/**
 * Build per-entity variation parameters from an archetype + entity ID.
 * Cached externally by entity ID for performance.
 */
export function buildVariation(archetype, entityId) {
  const rng = seededRandom(entityId);
  const v = archetype.variation;
  return {
    hueShift: sampleVariation(rng, v.hueShift),
    scaleJitter: sampleVariation(rng, v.scaleJitter),
    wobblePhase: sampleVariation(rng, v.wobblePhase),
    eyeSizeJitter: sampleVariation(rng, v.eyeSizeJitter),
    tailWaveOffset: sampleVariation(rng, v.tailWaveOffset),
    opacity: sampleVariation(rng, v.opacity) || 1.0,
    flickerSpeed: sampleVariation(rng, v.flickerSpeed) || 1.0,
    spikeJitter: sampleVariation(rng, v.spikeJitter) || 1.0,
  };
}
