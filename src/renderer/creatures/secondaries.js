/**
 * Procedural secondary motion modules.
 *
 * Each module adds archetype-specific procedural animation after the base
 * pose is sampled. These are what give each creature family its distinct
 * motion language — they are NOT generic wobble.
 *
 * Module interface:
 *   { id, apply(pose, skeleton, entity, time, dt, variation) }
 *
 * Modules modify specific bones in the local pose. They run after clip
 * sampling and overlays, producing the final motion personality.
 *
 * Available modules:
 *   ghost  — float drift, lower cloak lag, wisp drag
 *   ember  — flame tip flutter, flicker pulse, flare response
 *   brute  — heavy settle, delayed recoil, shoulder mass lag
 *   slime  — bouncy jiggle, surface ripple, squish response
 */

import { POSE_STRIDE, PX, PY, PROT, PSX, PSY } from './skeleton.js';

const TAU = Math.PI * 2;

// ── Registry ──

const secondaryModules = new Map();

export function registerSecondary(id, factory) {
  secondaryModules.set(id, factory);
}

export function getSecondary(id) {
  return secondaryModules.get(id) || null;
}

export function createSecondary(id, config = {}) {
  const factory = secondaryModules.get(id);
  return factory ? factory(config) : null;
}

// ── Ghost: ethereal float and trailing motion ──

registerSecondary('ghost', (config = {}) => {
  // Smoothed velocity for lag effect
  let smoothVx = 0, smoothVy = 0;
  const lagRate = config.lagRate || 0.08;

  return {
    id: 'ghost',
    apply(pose, skeleton, entity, time, dt, variation) {
      const phase = variation.wobblePhase || 0;

      // Float drift — gentle lateral sway independent of movement
      const driftBone = skeleton.getBoneIndex('body');
      if (driftBone !== -1) {
        const off = driftBone * POSE_STRIDE;
        pose[off + PX] += Math.sin(time * 0.7 + phase) * 0.5;
        pose[off + PY] += Math.cos(time * 0.5 + phase * 1.3) * 0.3;
      }

      // Smoothed velocity for lag
      smoothVx += (entity.vx - smoothVx) * lagRate;
      smoothVy += (entity.vy - smoothVy) * lagRate;
      const lagX = (entity.vx - smoothVx) * 0.02;
      const lagY = (entity.vy - smoothVy) * 0.02;

      // Lower cloak lag — tail/cloak bones drag behind movement
      for (const boneName of ['tail', 'cloak_lower', 'wisp_l', 'wisp_r']) {
        const idx = skeleton.getBoneIndex(boneName);
        if (idx === -1) continue;
        const off = idx * POSE_STRIDE;
        // Lag behind: opposite of velocity delta
        pose[off + PX] -= lagX * 3;
        pose[off + PY] -= lagY * 3;
        // Slight trailing rotation
        pose[off + PROT] += Math.sin(time * 1.2 + phase) * 0.15;
      }

      // Wisp drag — small trailing accents wave independently
      const wispL = skeleton.getBoneIndex('wisp_l');
      const wispR = skeleton.getBoneIndex('wisp_r');
      if (wispL !== -1) {
        const off = wispL * POSE_STRIDE;
        pose[off + PROT] += Math.sin(time * 2.3 + phase) * 0.25;
        pose[off + PY] += Math.sin(time * 1.7 + phase * 0.5) * 0.4;
      }
      if (wispR !== -1) {
        const off = wispR * POSE_STRIDE;
        pose[off + PROT] += Math.sin(time * 2.3 + phase + 2.1) * 0.25;
        pose[off + PY] += Math.sin(time * 1.7 + phase * 0.5 + 1.5) * 0.4;
      }

      // Head gentle tilt
      const head = skeleton.getBoneIndex('head');
      if (head !== -1) {
        const off = head * POSE_STRIDE;
        pose[off + PROT] += Math.sin(time * 0.9 + phase * 2) * 0.06;
      }
    },
  };
});

// ── Ember: flickering, pulsing flame motion ──

registerSecondary('ember', (config = {}) => {
  let flickerAccum = 0;

  return {
    id: 'ember',
    apply(pose, skeleton, entity, time, dt, variation) {
      const phase = variation.wobblePhase || 0;
      const flickerSpeed = variation.flickerSpeed || 1;
      flickerAccum += dt * flickerSpeed;

      // Flame tip flutter — top of the flame dances rapidly
      for (const boneName of ['flame_top', 'flame_left', 'flame_right']) {
        const idx = skeleton.getBoneIndex(boneName);
        if (idx === -1) continue;
        const off = idx * POSE_STRIDE;

        // High-frequency positional jitter
        const flutterX = Math.sin(time * 8 * flickerSpeed + phase) * 1.2;
        const flutterY = Math.sin(time * 6 * flickerSpeed + phase * 1.7) * 0.8;
        pose[off + PX] += flutterX;
        pose[off + PY] += flutterY;

        // Scale pulse — flame tips grow and shrink rapidly
        const pulse = 1 + Math.sin(time * 5 * flickerSpeed + phase) * 0.15;
        pose[off + PSX] *= pulse;
        pose[off + PSY] *= pulse;
      }

      // Flicker pulse — entire body brightness/scale oscillation
      const body = skeleton.getBoneIndex('body');
      if (body !== -1) {
        const off = body * POSE_STRIDE;
        const bodyPulse = 1 + Math.sin(time * 3 * flickerSpeed + phase) * 0.04;
        pose[off + PSX] *= bodyPulse;
        pose[off + PSY] *= bodyPulse;
      }

      // Flare response — expand briefly when moving fast
      const speed = Math.sqrt(entity.vx * entity.vx + entity.vy * entity.vy);
      if (speed > 30 && body !== -1) {
        const flare = Math.min(speed * 0.001, 0.08);
        const off = body * POSE_STRIDE;
        pose[off + PSX] *= 1 + flare;
        pose[off + PSY] *= 1 + flare;
      }

      // Head subtle wobble
      const head = skeleton.getBoneIndex('head');
      if (head !== -1) {
        const off = head * POSE_STRIDE;
        pose[off + PROT] += Math.sin(time * 4 + phase) * 0.04;
      }
    },
  };
});

// ── Brute: heavy, weighty motion ──

registerSecondary('brute', (config = {}) => {
  let prevVx = 0, prevVy = 0;
  let settleEnergy = 0;

  return {
    id: 'brute',
    apply(pose, skeleton, entity, time, dt, variation) {
      const phase = variation.wobblePhase || 0;

      // Heavy settle — body sinks slightly, recovers slowly
      const speed = Math.sqrt(entity.vx * entity.vx + entity.vy * entity.vy);
      const decel = Math.max(0, Math.sqrt(prevVx * prevVx + prevVy * prevVy) - speed);
      settleEnergy += decel * 0.01;
      settleEnergy *= 0.92; // decay
      prevVx = entity.vx;
      prevVy = entity.vy;

      const body = skeleton.getBoneIndex('body');
      if (body !== -1) {
        const off = body * POSE_STRIDE;
        // Downward settle on deceleration
        pose[off + PY] += settleEnergy * 2;
        // Wider stance when moving
        if (speed > 10) {
          pose[off + PSX] *= 1 + Math.min(speed * 0.0005, 0.04);
        }
      }

      // Shoulder/body mass lag — upper body lags behind direction changes
      for (const boneName of ['left_shoulder', 'right_shoulder', 'chest']) {
        const idx = skeleton.getBoneIndex(boneName);
        if (idx === -1) continue;
        const off = idx * POSE_STRIDE;
        // Slight opposite-to-velocity rotation (momentum)
        const vAngle = Math.atan2(entity.vy, entity.vx);
        pose[off + PROT] += Math.sin(time * 0.8 + phase) * 0.03;
        // Mass lag: shift opposite to direction
        if (speed > 15) {
          pose[off + PX] -= Math.cos(vAngle) * 0.3;
          pose[off + PY] -= Math.sin(vAngle) * 0.3;
        }
      }

      // Delayed arm swing
      const leftArm = skeleton.getBoneIndex('left_arm');
      const rightArm = skeleton.getBoneIndex('right_arm');
      if (leftArm !== -1 && speed > 10) {
        const off = leftArm * POSE_STRIDE;
        pose[off + PROT] += Math.sin(time * 3 + phase) * 0.12;
      }
      if (rightArm !== -1 && speed > 10) {
        const off = rightArm * POSE_STRIDE;
        pose[off + PROT] += Math.sin(time * 3 + phase + Math.PI) * 0.12;
      }

      // Head — minimal independent motion, heavy and deliberate
      const head = skeleton.getBoneIndex('head');
      if (head !== -1) {
        const off = head * POSE_STRIDE;
        pose[off + PROT] += Math.sin(time * 0.5 + phase) * 0.02;
      }
    },
  };
});

// ── Slime/Imp: bouncy, springy, lively ──

registerSecondary('slime', (config = {}) => {
  let bounceEnergy = 0;

  return {
    id: 'slime',
    apply(pose, skeleton, entity, time, dt, variation) {
      const phase = variation.wobblePhase || 0;
      const speed = Math.sqrt(entity.vx * entity.vx + entity.vy * entity.vy);

      // Springy bounce — vertical oscillation tied to speed
      bounceEnergy += speed * dt * 0.02;
      bounceEnergy *= 0.95;

      const body = skeleton.getBoneIndex('body');
      if (body !== -1) {
        const off = body * POSE_STRIDE;
        // Bounce
        const bounce = Math.sin(time * 6 + phase) * Math.min(bounceEnergy, 2);
        pose[off + PY] += bounce;
        // Squish on landing phase
        const squishPhase = Math.sin(time * 6 + phase);
        if (squishPhase > 0.5) {
          pose[off + PSX] *= 1 + squishPhase * 0.05;
          pose[off + PSY] *= 1 - squishPhase * 0.03;
        }
      }

      // Quick head darts — scale with speed so idle is calm
      const head = skeleton.getBoneIndex('head');
      const speedFactor = speed > 5 ? Math.min(speed / 60, 1) : 0.15;
      if (head !== -1) {
        const off = head * POSE_STRIDE;
        const dart = Math.sin(time * 7 + phase * 3);
        pose[off + PROT] += dart * 0.06 * speedFactor;
        pose[off + PX] += dart * 0.3 * speedFactor;
      }

      // Lively arm/appendage motion — subtle at idle, full at speed
      const leftArm = skeleton.getBoneIndex('left_arm');
      const rightArm = skeleton.getBoneIndex('right_arm');
      const armFactor = speed > 5 ? Math.min(speed / 40, 1) : 0.2;
      if (leftArm !== -1) {
        const off = leftArm * POSE_STRIDE;
        pose[off + PROT] += Math.sin(time * 4.5 + phase + 1) * 0.15 * armFactor;
      }
      if (rightArm !== -1) {
        const off = rightArm * POSE_STRIDE;
        pose[off + PROT] += Math.sin(time * 4.5 + phase + 3.5) * 0.15 * armFactor;
      }

      // Surface ripple — the body outline pulses with localized waves
      // (This is handled by the wobble deformation which already exists,
      //  but we enhance it here with speed-responsive amplitude)
      if (body !== -1 && speed > 20) {
        const off = body * POSE_STRIDE;
        const ripple = Math.sin(time * 8 + phase) * Math.min(speed * 0.0003, 0.03);
        pose[off + PSX] *= 1 + ripple;
        pose[off + PSY] *= 1 - ripple * 0.5;
      }
    },
  };
});
