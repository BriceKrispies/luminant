/**
 * Cooldown and status effect system.
 * Tracks named timers and temporary effects with durations.
 */

export function createCooldownSystem() {
  const timers = new Map();    // name -> remaining seconds
  const effects = new Map();   // name -> { duration, data }

  return {
    /** Set a cooldown timer */
    setCooldown(name, duration) {
      timers.set(name, duration);
    },

    /** Check if a cooldown is ready (expired or not set) */
    isReady(name) {
      return !timers.has(name) || timers.get(name) <= 0;
    },

    /** Get remaining time for a cooldown */
    getRemaining(name) {
      return timers.get(name) || 0;
    },

    /** Add a timed status effect */
    addEffect(name, duration, data = {}) {
      effects.set(name, { duration, data });
    },

    /** Check if an effect is active */
    hasEffect(name) {
      return effects.has(name) && effects.get(name).duration > 0;
    },

    /** Get effect data if active */
    getEffect(name) {
      if (!effects.has(name)) return null;
      const e = effects.get(name);
      return e.duration > 0 ? e.data : null;
    },

    /** Tick all timers and effects */
    update(dt) {
      for (const [name, remaining] of timers) {
        const next = remaining - dt;
        if (next <= 0) timers.delete(name);
        else timers.set(name, next);
      }
      for (const [name, effect] of effects) {
        effect.duration -= dt;
        if (effect.duration <= 0) effects.delete(name);
      }
    },

    reset() {
      timers.clear();
      effects.clear();
    },
  };
}
