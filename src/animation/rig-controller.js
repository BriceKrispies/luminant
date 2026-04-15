/**
 * Rig controller — maps entity snapshot state into animation parameters.
 *
 * Reads entity state (position, velocity, HP, facing, alive/dying) and drives:
 *   - clip selection + blend weights
 *   - procedural offsets (hover, lean, recoil, drag)
 *   - IK targets (look direction)
 *   - constraint parameters
 *
 * The controller produces an AnimParams object consumed by runtime.js.
 */

import { STRIDE, TX, TY, ROT, SX, SY } from './pose.js';

const STATE_IDLE = 'idle';
const STATE_DRIFT = 'drift';
const STATE_CHASE = 'chase';
const STATE_ATTACK_WINDUP = 'attack_windup';
const STATE_ATTACK_RELEASE = 'attack_release';
const STATE_HIT_REACT = 'hit_react';
const STATE_DEATH = 'death';
const STATE_SPAWN = 'spawn';

/**
 * Create a rig controller for a character.
 *
 * @param {object} clips — map of clip name → clip data
 * @param {object} [config] — tuning params
 */
export function createRigController(clips, config = {}) {
  const cfg = {
    idleSpeedThreshold: config.idleSpeedThreshold || 5,
    driftSpeedThreshold: config.driftSpeedThreshold || 30,
    hoverAmp: config.hoverAmp || 0.6,
    hoverFreq: config.hoverFreq || 0.7,
    leanFactor: config.leanFactor || 0.003,
    maxLean: config.maxLean || 0.15,
    headLagFactor: config.headLagFactor || 0.002,
    maxHeadLag: config.maxHeadLag || 0.2,
    recoilDecay: config.recoilDecay || 5,
    dragStiffness: config.dragStiffness || 0.25,
    spawnDuration: config.spawnDuration || 0.5,
    hitReactDuration: config.hitReactDuration || 0.3,
  };

  // State machine
  let currentState = STATE_SPAWN;
  let stateTime = 0;
  let prevHp = -1;
  let recoilIntensity = 0;
  let prevSpeed = 0;
  let smoothVx = 0;
  let smoothVy = 0;

  // Blend weights
  let baseClipName = 'idle';
  let overlayClipName = null;
  let baseWeight = 1;
  let overlayWeight = 0;
  let crossfadeTime = 0;
  let crossfadeDuration = 0;
  let crossfadeFrom = null;

  return {
    get state() { return currentState; },
    get stateTime() { return stateTime; },

    /**
     * Update controller from entity snapshot.
     * @param {object} entity — snapshot entity
     * @param {number} dt — frame delta
     * @param {number} gameTime — total game time
     * @returns {object} AnimParams for the runtime
     */
    update(entity, dt, gameTime) {
      const speed = Math.sqrt(entity.vx * entity.vx + entity.vy * entity.vy);
      const isDying = entity.state === 2;

      // Smooth velocity for drag effects
      const lagRate = 0.1;
      smoothVx += (entity.vx - smoothVx) * lagRate;
      smoothVy += (entity.vy - smoothVy) * lagRate;

      // Hit detection
      if (prevHp > 0 && entity.hp < prevHp && !isDying) {
        recoilIntensity = 1;
        if (currentState !== STATE_DEATH) {
          transitionTo(STATE_HIT_REACT, 0.05);
        }
      }
      prevHp = entity.hp;

      // Recoil decay
      recoilIntensity = Math.max(0, recoilIntensity - cfg.recoilDecay * dt);

      // State machine
      stateTime += dt;

      if (isDying && currentState !== STATE_DEATH) {
        transitionTo(STATE_DEATH, 0.1);
      } else if (!isDying) {
        switch (currentState) {
          case STATE_SPAWN:
            if (stateTime >= cfg.spawnDuration) transitionTo(STATE_IDLE, 0.2);
            break;
          case STATE_HIT_REACT:
            if (stateTime >= cfg.hitReactDuration) {
              transitionTo(speed > cfg.driftSpeedThreshold ? STATE_CHASE :
                           speed > cfg.idleSpeedThreshold ? STATE_DRIFT : STATE_IDLE, 0.15);
            }
            break;
          case STATE_IDLE:
            if (speed > cfg.driftSpeedThreshold) transitionTo(STATE_CHASE, 0.2);
            else if (speed > cfg.idleSpeedThreshold) transitionTo(STATE_DRIFT, 0.3);
            break;
          case STATE_DRIFT:
            if (speed > cfg.driftSpeedThreshold) transitionTo(STATE_CHASE, 0.15);
            else if (speed < cfg.idleSpeedThreshold) transitionTo(STATE_IDLE, 0.3);
            break;
          case STATE_CHASE:
            if (speed < cfg.idleSpeedThreshold) transitionTo(STATE_IDLE, 0.2);
            else if (speed < cfg.driftSpeedThreshold) transitionTo(STATE_DRIFT, 0.2);
            break;
          case STATE_ATTACK_WINDUP:
          case STATE_ATTACK_RELEASE:
            // External trigger controls these
            break;
        }
      }

      // Crossfade blending
      if (crossfadeDuration > 0 && crossfadeTime < crossfadeDuration) {
        crossfadeTime += dt;
        const t = Math.min(crossfadeTime / crossfadeDuration, 1);
        baseWeight = t;
        overlayWeight = 0;
      } else {
        baseWeight = 1;
        crossfadeFrom = null;
      }

      // Procedural overlays
      const hover = Math.sin(gameTime * cfg.hoverFreq * Math.PI * 2) * cfg.hoverAmp;

      const lean = Math.max(-cfg.maxLean, Math.min(cfg.maxLean, speed * cfg.leanFactor));
      const headLag = Math.max(-cfg.maxHeadLag, Math.min(cfg.maxHeadLag,
        (entity.vx - smoothVx) * cfg.headLagFactor));

      // Look direction (toward movement)
      const lookAngle = speed > cfg.idleSpeedThreshold ?
        Math.atan2(entity.vy, entity.vx) : entity.facing;

      prevSpeed = speed;

      return {
        // Clip selection
        baseClip: clips[baseClipName] || clips.idle,
        baseClipName,
        baseTime: stateTime,
        baseWeight,
        crossfadeFromClip: crossfadeFrom ? (clips[crossfadeFrom] || null) : null,
        crossfadeFromTime: crossfadeTime,
        crossfadeWeight: crossfadeFrom ? (1 - baseWeight) : 0,

        // Procedural overrides
        hoverOffset: hover,
        torsoLean: lean,
        headLagRotation: headLag,
        recoilIntensity,
        dragVx: entity.vx - smoothVx,
        dragVy: entity.vy - smoothVy,

        // IK / constraints
        lookAngle,
        lookWeight: speed > cfg.idleSpeedThreshold ? 0.6 : 0.2,

        // Entity state
        speed,
        facing: entity.facing,
        isDying,
        state: currentState,
      };
    },

    /**
     * Trigger an attack sequence externally.
     */
    triggerAttack() {
      transitionTo(STATE_ATTACK_WINDUP, 0.05);
      // Attack release handled by clip finish
    },

    /**
     * Reset controller state.
     */
    reset() {
      currentState = STATE_SPAWN;
      stateTime = 0;
      prevHp = -1;
      recoilIntensity = 0;
      smoothVx = 0;
      smoothVy = 0;
      crossfadeFrom = null;
      crossfadeDuration = 0;
      baseClipName = 'spawn';
      baseWeight = 1;
    },
  };

  function transitionTo(newState, fadeDuration = 0.15) {
    crossfadeFrom = baseClipName;
    crossfadeTime = 0;
    crossfadeDuration = fadeDuration;
    currentState = newState;
    stateTime = 0;
    baseClipName = newState;
  }
}
