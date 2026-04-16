/**
 * Fixed-timestep simulation clock.
 * Accumulates real time and dispatches fixed-dt ticks.
 */

export function createClock(fixedDt = 1 / 60, maxStepsPerFrame = 5) {
  let accumulator = 0;
  let totalTime = 0;
  let frameCount = 0;
  let lastRealTime = 0;
  let paused = false;
  let freezeFrames = 0;

  // FPS tracking
  let fpsAccum = 0;
  let fpsFrames = 0;
  let fps = 0;

  return {
    get fixedDt() { return fixedDt; },
    get totalTime() { return totalTime; },
    get frameCount() { return frameCount; },
    get fps() { return fps; },
    get paused() { return paused; },
    set paused(v) { paused = v; },

    addFreeze(frames) {
      freezeFrames += frames;
    },

    /** Call once at start to sync the clock. Resets game time. */
    start() {
      lastRealTime = performance.now() / 1000;
      accumulator = 0;
      totalTime = 0;
      frameCount = 0;
    },

    /**
     * Called each animation frame. Returns an array of fixed timesteps to process.
     * Typical usage: for (const dt of clock.update(now)) { engine.step(dt); }
     */
    update(nowMs) {
      const now = nowMs / 1000;
      let elapsed = now - lastRealTime;
      lastRealTime = now;

      // FPS
      fpsAccum += elapsed;
      fpsFrames++;
      if (fpsAccum >= 0.5) {
        fps = Math.round(fpsFrames / fpsAccum);
        fpsAccum = 0;
        fpsFrames = 0;
      }

      if (paused) return [];

      // Hit stop: consume a freeze frame instead of advancing simulation
      if (freezeFrames > 0) {
        freezeFrames--;
        return [];
      }

      // Clamp to prevent spiral of death
      if (elapsed > 0.25) elapsed = 0.25;

      accumulator += elapsed;
      const steps = [];
      let count = 0;
      while (accumulator >= fixedDt && count < maxStepsPerFrame) {
        steps.push(fixedDt);
        accumulator -= fixedDt;
        totalTime += fixedDt;
        frameCount++;
        count++;
      }
      return steps;
    },

    /** Interpolation alpha for rendering between ticks */
    get alpha() {
      return accumulator / fixedDt;
    },
  };
}
