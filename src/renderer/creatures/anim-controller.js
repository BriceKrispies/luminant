/**
 * Animation state machine / controller.
 *
 * Manages animation state selection, transitions, and playback for a creature.
 * Supports:
 *   - Named states mapped to clips
 *   - Smooth crossfade transitions between states
 *   - One-shot interrupts (hit, attack) that return to base state
 *   - Base locomotion state selection from entity data
 *
 * States:
 *   'idle'         — standing still
 *   'locomotion'   — moving
 *   'attack'       — attack wind-up + swing + recovery
 *   'hit_react'    — damage reaction
 *   'dying'        — death animation
 *
 * The controller produces the current clip(s) to sample and their blend weights.
 * It does NOT sample poses — that's the resolver's job.
 */

import { isClipFinished } from './animation.js';

/**
 * @typedef {Object} StateConfig
 * @property {string} clip — clip name to play
 * @property {boolean} [loop=true] — whether the clip loops
 * @property {string} [next] — state to transition to when clip finishes (for one-shots)
 * @property {number} [blendIn=0.1] — crossfade duration when entering this state
 * @property {number} [priority=0] — higher priority states can interrupt lower ones
 */

/**
 * Create an animation controller.
 *
 * @param {Object} stateConfigs — { stateName: StateConfig }
 * @param {Object} clips — { clipName: Clip }
 * @param {string} [initialState='idle']
 */
export function createAnimController(stateConfigs, clips, initialState = 'idle') {
  let currentState = initialState;
  let currentTime = 0;
  let prevState = null;
  let prevTime = 0;
  let blendTimer = 0;
  let blendDuration = 0;

  // One-shot queue: pending one-shot states
  let pendingOneShot = null;
  let returnState = null;

  return {
    /** Current animation state name */
    get state() { return currentState; },

    /** Current clip playback time */
    get time() { return currentTime; },

    /** Whether a crossfade is in progress */
    get isBlending() { return blendTimer < blendDuration && prevState !== null; },

    /** Current blend weight (0 = fully prev, 1 = fully current) */
    get blendWeight() {
      if (!prevState || blendDuration <= 0) return 1;
      return Math.min(blendTimer / blendDuration, 1);
    },

    /**
     * Get the current playback state(s) for sampling.
     * Returns { layers: [{ clip, time, weight }] }
     */
    getPlayback() {
      const layers = [];
      const config = stateConfigs[currentState];
      const clip = config ? clips[config.clip] : null;

      if (this.isBlending && prevState) {
        const prevConfig = stateConfigs[prevState];
        const prevClip = prevConfig ? clips[prevConfig.clip] : null;
        const w = this.blendWeight;

        if (prevClip) {
          layers.push({ clip: prevClip, time: prevTime, weight: 1 - w });
        }
        if (clip) {
          layers.push({ clip, time: currentTime, weight: w });
        }
      } else if (clip) {
        layers.push({ clip, time: currentTime, weight: 1 });
      }

      return { layers, state: currentState };
    },

    /**
     * Update the controller by dt seconds.
     * Call once per frame before sampling.
     *
     * @param {number} dt
     * @param {Object} entity — snapshot entity for auto state detection
     */
    update(dt, entity) {
      // Advance timers
      currentTime += dt;
      if (prevState) {
        prevTime += dt;
        blendTimer += dt;
        if (blendTimer >= blendDuration) {
          prevState = null;
        }
      }

      // Check if current one-shot has finished
      const config = stateConfigs[currentState];
      if (config && config.next) {
        const clip = clips[config.clip];
        if (clip && isClipFinished(clip, currentTime)) {
          this._transitionTo(config.next, stateConfigs[config.next]?.blendIn || 0.05);
          returnState = null;
        }
      }

      // Process pending one-shot
      if (pendingOneShot) {
        const shotState = pendingOneShot;
        pendingOneShot = null;
        const shotConfig = stateConfigs[shotState];
        if (shotConfig) {
          returnState = this._getBaseState(entity);
          // Set next to return to base if not already set
          if (!shotConfig.next) {
            shotConfig.next = returnState;
          }
          this._transitionTo(shotState, shotConfig.blendIn || 0.05);
        }
      }

      // Auto-detect base state from entity data (only if not in a one-shot)
      if (!this._isOneShot(currentState)) {
        const desired = this._getBaseState(entity);
        if (desired !== currentState) {
          const desiredConfig = stateConfigs[desired];
          this._transitionTo(desired, desiredConfig?.blendIn || 0.1);
        }
      }
    },

    /**
     * Queue a one-shot action (hit, attack).
     * Interrupts current state and returns to base when done.
     */
    playOneShot(stateName) {
      const config = stateConfigs[stateName];
      if (!config) return;

      // Higher priority can interrupt current one-shot
      const currentConfig = stateConfigs[currentState];
      const currentPriority = currentConfig?.priority || 0;
      const newPriority = config.priority || 0;

      if (this._isOneShot(currentState) && newPriority <= currentPriority) {
        return; // don't interrupt higher-priority one-shots
      }

      pendingOneShot = stateName;
    },

    /**
     * Force a state transition immediately.
     */
    forceState(stateName, blendIn = 0) {
      this._transitionTo(stateName, blendIn);
    },

    /**
     * Reset the controller to initial state.
     */
    reset() {
      currentState = initialState;
      currentTime = 0;
      prevState = null;
      prevTime = 0;
      blendTimer = 0;
      blendDuration = 0;
      pendingOneShot = null;
      returnState = null;
    },

    // ── Internal ──

    _transitionTo(newState, blendIn) {
      if (newState === currentState) return;
      prevState = currentState;
      prevTime = currentTime;
      blendTimer = 0;
      blendDuration = blendIn || 0;
      currentState = newState;
      currentTime = 0;
    },

    _getBaseState(entity) {
      if (!entity) return 'idle';
      if (entity.state === 2) return 'dying';

      const speed = Math.sqrt(entity.vx * entity.vx + entity.vy * entity.vy);
      if (speed > 5) return 'locomotion';
      return 'idle';
    },

    _isOneShot(state) {
      const config = stateConfigs[state];
      return config && config.next !== undefined && config.next !== null;
    },
  };
}
