/**
 * Ghost Witch animation clips — hand-authored keyframes.
 *
 * Each clip defines tracks for specific bones with translation,
 * rotation, and/or scale keyframes. Bones not animated in a clip
 * remain at their bind pose values.
 *
 * Conventions:
 *   - Times in seconds
 *   - Rotation in radians
 *   - Translation in bone-local units
 *   - Scale as multiplier
 */

import { clip, track, kf } from '../../animation/clip.js';

// ── Idle — breathing sway with independent limb motion ──

export const IDLE = clip('idle', 2.0, [
  track('torso', {
    sy: [kf(0, 1), kf(1, 1.03), kf(2, 1)],
    rot: [kf(0, 0), kf(1, 0.04), kf(2, 0)],
  }),
  track('head', {
    rot: [kf(0, 0), kf(0.5, -0.08), kf(1.0, 0.06), kf(1.5, -0.04), kf(2, 0)],
    ty: [kf(0, -5), kf(0.7, -5.2), kf(1.4, -4.9), kf(2, -5)],
  }),
  track('left_upper_arm', {
    rot: [kf(0, -0.3), kf(0.6, -0.55), kf(1.3, -0.2), kf(2, -0.3)],
  }),
  track('right_upper_arm', {
    rot: [kf(0, 0.3), kf(0.8, 0.15), kf(1.5, 0.5), kf(2, 0.3)],
  }),
  track('left_lower_arm', {
    rot: [kf(0, 0), kf(0.7, -0.15), kf(1.5, 0.08), kf(2, 0)],
  }),
  track('right_lower_arm', {
    rot: [kf(0, 0), kf(0.5, 0.12), kf(1.2, -0.1), kf(2, 0)],
  }),
  track('left_hand', {
    rot: [kf(0, 0), kf(0.5, -0.25), kf(1.0, 0.15), kf(1.6, -0.1), kf(2, 0)],
  }),
  track('right_hand', {
    rot: [kf(0, 0), kf(0.4, 0.2), kf(0.9, -0.2), kf(1.4, 0.15), kf(2, 0)],
  }),
  track('robe_upper', {
    rot: [kf(0, 0), kf(0.8, 0.06), kf(1.6, -0.04), kf(2, 0)],
  }),
  track('robe_mid', {
    rot: [kf(0, 0), kf(1.0, 0.1), kf(2, 0)],
  }),
  track('robe_lower', {
    rot: [kf(0, 0), kf(0.7, -0.08), kf(1.5, 0.08), kf(2, 0)],
  }),
  track('robe_tip', {
    rot: [kf(0, 0), kf(0.9, 0.06), kf(1.8, -0.04), kf(2, 0)],
  }),
]);

// ── Drift — floating movement with arm swing ──

export const DRIFT = clip('drift', 1.5, [
  track('torso', {
    rot: [kf(0, -0.08), kf(0.75, 0.08), kf(1.5, -0.08)],
    ty: [kf(0, -2), kf(0.75, -2.5), kf(1.5, -2)],
  }),
  track('head', {
    rot: [kf(0, 0.06), kf(0.4, -0.08), kf(0.8, 0.06), kf(1.2, -0.04), kf(1.5, 0.06)],
    tx: [kf(0, 0), kf(0.5, -0.3), kf(1.0, 0.3), kf(1.5, 0)],
  }),
  track('left_upper_arm', {
    rot: [kf(0, -0.5), kf(0.4, -0.15), kf(0.75, -0.6), kf(1.1, -0.2), kf(1.5, -0.5)],
  }),
  track('right_upper_arm', {
    rot: [kf(0, 0.15), kf(0.35, 0.55), kf(0.75, 0.1), kf(1.15, 0.5), kf(1.5, 0.15)],
  }),
  track('left_lower_arm', {
    rot: [kf(0, -0.05), kf(0.5, -0.2), kf(1.0, 0.05), kf(1.5, -0.05)],
  }),
  track('right_lower_arm', {
    rot: [kf(0, 0.05), kf(0.4, 0.18), kf(0.9, -0.05), kf(1.5, 0.05)],
  }),
  track('left_hand', {
    rot: [kf(0, 0), kf(0.3, -0.2), kf(0.8, 0.15), kf(1.5, 0)],
  }),
  track('right_hand', {
    rot: [kf(0, 0), kf(0.5, 0.25), kf(1.1, -0.1), kf(1.5, 0)],
  }),
  track('robe_upper', {
    rot: [kf(0, 0.08), kf(0.75, -0.08), kf(1.5, 0.08)],
  }),
  track('robe_mid', {
    rot: [kf(0, 0.12), kf(0.5, -0.06), kf(1.0, 0.1), kf(1.5, 0.12)],
  }),
  track('robe_lower', {
    rot: [kf(0, 0.1), kf(0.4, -0.1), kf(0.8, 0.1), kf(1.2, -0.06), kf(1.5, 0.1)],
  }),
  track('robe_tip', {
    rot: [kf(0, 0.06), kf(0.5, -0.08), kf(1.0, 0.08), kf(1.5, 0.06)],
  }),
]);

// ── Chase — aggressive forward lean with pumping arms ──

export const CHASE = clip('chase', 0.8, [
  track('torso', {
    rot: [kf(0, -0.15), kf(0.4, -0.08), kf(0.8, -0.15)],
    ty: [kf(0, -2.8), kf(0.4, -1.8), kf(0.8, -2.8)],
  }),
  track('head', {
    rot: [kf(0, 0.1), kf(0.2, 0.02), kf(0.4, 0.1), kf(0.6, 0.04), kf(0.8, 0.1)],
    ty: [kf(0, -5.4), kf(0.4, -4.6), kf(0.8, -5.4)],
  }),
  track('left_upper_arm', {
    rot: [kf(0, -0.7), kf(0.2, -0.15), kf(0.4, -0.8), kf(0.6, -0.2), kf(0.8, -0.7)],
  }),
  track('right_upper_arm', {
    rot: [kf(0, 0.15), kf(0.2, 0.75), kf(0.4, 0.1), kf(0.6, 0.7), kf(0.8, 0.15)],
  }),
  track('left_lower_arm', {
    rot: [kf(0, -0.15), kf(0.2, -0.35), kf(0.4, -0.1), kf(0.6, -0.3), kf(0.8, -0.15)],
  }),
  track('right_lower_arm', {
    rot: [kf(0, 0.1), kf(0.2, 0.3), kf(0.4, 0.15), kf(0.6, 0.35), kf(0.8, 0.1)],
  }),
  track('left_hand', {
    rot: [kf(0, -0.1), kf(0.2, 0.2), kf(0.4, -0.15), kf(0.6, 0.15), kf(0.8, -0.1)],
  }),
  track('right_hand', {
    rot: [kf(0, 0.1), kf(0.2, -0.2), kf(0.4, 0.15), kf(0.6, -0.15), kf(0.8, 0.1)],
  }),
  track('hair', {
    rot: [kf(0, 0.08), kf(0.4, -0.06), kf(0.8, 0.08)],
  }),
  track('robe_upper', {
    rot: [kf(0, 0.15), kf(0.4, -0.08), kf(0.8, 0.15)],
  }),
  track('robe_mid', {
    rot: [kf(0, 0.18), kf(0.3, -0.05), kf(0.6, 0.15), kf(0.8, 0.18)],
  }),
  track('robe_lower', {
    rot: [kf(0, 0.12), kf(0.25, -0.12), kf(0.5, 0.12), kf(0.75, -0.08), kf(0.8, 0.12)],
  }),
  track('robe_tip', {
    rot: [kf(0, 0.1), kf(0.3, -0.1), kf(0.6, 0.1), kf(0.8, 0.1)],
  }),
]);

// ── Attack Windup — arms pull back wide ──

export const ATTACK_WINDUP = clip('attack_windup', 0.25, [
  track('torso', {
    rot: [kf(0, 0), kf(0.25, 0.2)],
    sy: [kf(0, 1), kf(0.25, 1.06)],
  }),
  track('head', {
    rot: [kf(0, 0), kf(0.25, -0.1)],
  }),
  track('left_upper_arm', {
    rot: [kf(0, -0.3), kf(0.25, -1.1)],
  }),
  track('right_upper_arm', {
    rot: [kf(0, 0.3), kf(0.25, 1.1)],
  }),
  track('left_lower_arm', {
    rot: [kf(0, 0), kf(0.25, -0.6)],
  }),
  track('right_lower_arm', {
    rot: [kf(0, 0), kf(0.25, 0.6)],
  }),
  track('left_hand', {
    rot: [kf(0, 0), kf(0.25, -0.4)],
    sx: [kf(0, 1), kf(0.25, 1.3)],
  }),
  track('right_hand', {
    rot: [kf(0, 0), kf(0.25, 0.4)],
    sx: [kf(0, 1), kf(0.25, 1.3)],
  }),
], { loop: false });

// ── Attack Release — thrust forward with full body follow-through ──

export const ATTACK_RELEASE = clip('attack_release', 0.3, [
  track('torso', {
    rot: [kf(0, 0.2), kf(0.08, -0.25), kf(0.3, 0)],
    ty: [kf(0, -2), kf(0.08, -3.5), kf(0.3, -2)],
  }),
  track('head', {
    rot: [kf(0, -0.1), kf(0.08, 0.12), kf(0.3, 0)],
  }),
  track('left_upper_arm', {
    rot: [kf(0, -1.1), kf(0.08, 0.4), kf(0.2, 0.1), kf(0.3, -0.3)],
  }),
  track('right_upper_arm', {
    rot: [kf(0, 1.1), kf(0.08, -0.4), kf(0.2, -0.1), kf(0.3, 0.3)],
  }),
  track('left_lower_arm', {
    rot: [kf(0, -0.6), kf(0.08, 0.2), kf(0.3, 0)],
  }),
  track('right_lower_arm', {
    rot: [kf(0, 0.6), kf(0.08, -0.2), kf(0.3, 0)],
  }),
  track('left_hand', {
    rot: [kf(0, -0.4), kf(0.08, 0.5), kf(0.3, 0)],
    sx: [kf(0, 1.3), kf(0.12, 1.4), kf(0.3, 1)],
  }),
  track('right_hand', {
    rot: [kf(0, 0.4), kf(0.08, -0.5), kf(0.3, 0)],
    sx: [kf(0, 1.3), kf(0.12, 1.4), kf(0.3, 1)],
  }),
  track('robe_upper', {
    rot: [kf(0, 0), kf(0.1, 0.15), kf(0.3, 0)],
  }),
], { loop: false });

// ── Hit React — flinch with arms thrown back ──

export const HIT_REACT = clip('hit_react', 0.3, [
  track('torso', {
    rot: [kf(0, 0), kf(0.04, 0.2), kf(0.12, 0.15), kf(0.3, 0)],
    ty: [kf(0, -2), kf(0.04, -0.5), kf(0.3, -2)],
    sx: [kf(0, 1), kf(0.04, 1.08), kf(0.3, 1)],
  }),
  track('head', {
    rot: [kf(0, 0), kf(0.04, -0.25), kf(0.15, -0.1), kf(0.3, 0)],
  }),
  track('left_upper_arm', {
    rot: [kf(0, -0.3), kf(0.04, -0.9), kf(0.15, -0.5), kf(0.3, -0.3)],
  }),
  track('right_upper_arm', {
    rot: [kf(0, 0.3), kf(0.04, 0.9), kf(0.15, 0.5), kf(0.3, 0.3)],
  }),
  track('left_lower_arm', {
    rot: [kf(0, 0), kf(0.04, -0.3), kf(0.3, 0)],
  }),
  track('right_lower_arm', {
    rot: [kf(0, 0), kf(0.04, 0.3), kf(0.3, 0)],
  }),
  track('robe_upper', {
    rot: [kf(0, 0), kf(0.08, 0.15), kf(0.3, 0)],
  }),
  track('robe_mid', {
    rot: [kf(0, 0), kf(0.1, 0.1), kf(0.3, 0)],
  }),
], { loop: false });

// ── Death — collapse with limbs spreading outward ──

export const DEATH = clip('death', 0.6, [
  track('torso', {
    rot: [kf(0, 0), kf(0.15, 0.3), kf(0.6, 0.9)],
    sy: [kf(0, 1), kf(0.3, 0.85), kf(0.6, 0.5)],
    sx: [kf(0, 1), kf(0.3, 1.15), kf(0.6, 1.4)],
  }),
  track('head', {
    rot: [kf(0, 0), kf(0.2, -0.5), kf(0.6, -0.8)],
    ty: [kf(0, -5), kf(0.6, -2.5)],
  }),
  track('left_upper_arm', {
    rot: [kf(0, -0.3), kf(0.2, -1.4), kf(0.6, -1.8)],
  }),
  track('right_upper_arm', {
    rot: [kf(0, 0.3), kf(0.2, 1.4), kf(0.6, 1.8)],
  }),
  track('left_lower_arm', {
    rot: [kf(0, 0), kf(0.3, -0.4), kf(0.6, -0.6)],
  }),
  track('right_lower_arm', {
    rot: [kf(0, 0), kf(0.3, 0.4), kf(0.6, 0.6)],
  }),
  track('left_hand', {
    rot: [kf(0, 0), kf(0.3, -0.3), kf(0.6, -0.5)],
  }),
  track('right_hand', {
    rot: [kf(0, 0), kf(0.3, 0.3), kf(0.6, 0.5)],
  }),
  track('robe_upper', {
    rot: [kf(0, 0), kf(0.3, 0.25), kf(0.6, 0.5)],
  }),
  track('robe_mid', {
    rot: [kf(0, 0), kf(0.4, 0.2), kf(0.6, 0.4)],
  }),
  track('robe_lower', {
    sx: [kf(0, 1), kf(0.6, 1.4)],
    sy: [kf(0, 1), kf(0.6, 0.6)],
    rot: [kf(0, 0), kf(0.4, -0.15), kf(0.6, -0.25)],
  }),
], { loop: false });

// ── Spawn — materialize from nothing ──

export const SPAWN = clip('spawn', 0.5, [
  track('root', {
    sy: [kf(0, 0.01), kf(0.2, 1.1), kf(0.35, 0.95), kf(0.5, 1)],
    sx: [kf(0, 0.01), kf(0.2, 0.9), kf(0.35, 1.05), kf(0.5, 1)],
  }),
  track('torso', {
    ty: [kf(0, 3), kf(0.3, -2.5), kf(0.5, -2)],
    rot: [kf(0, 0.3), kf(0.3, -0.05), kf(0.5, 0)],
  }),
  track('head', {
    rot: [kf(0, -0.2), kf(0.3, 0.05), kf(0.5, 0)],
  }),
  track('left_upper_arm', {
    rot: [kf(0, -1), kf(0.3, -0.2), kf(0.5, -0.3)],
  }),
  track('right_upper_arm', {
    rot: [kf(0, 1), kf(0.3, 0.2), kf(0.5, 0.3)],
  }),
  track('robe_lower', {
    sy: [kf(0, 0.3), kf(0.35, 1.1), kf(0.5, 1)],
  }),
], { loop: false });

// ── Clip map (for runtime use) ──

export const GHOST_WITCH_CLIPS = {
  idle: IDLE,
  drift: DRIFT,
  chase: CHASE,
  attack_windup: ATTACK_WINDUP,
  attack_release: ATTACK_RELEASE,
  hit_react: HIT_REACT,
  death: DEATH,
  spawn: SPAWN,
};
