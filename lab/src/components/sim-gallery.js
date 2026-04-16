/**
 * SimGallery — manages a grid of SimInstances with a shared rAF loop.
 *
 * Single requestAnimationFrame drives all instances: tick N steps per
 * frame (controlled by speed multiplier), then render each.
 */

import { createSimInstance, listPolicies } from './sim-instance.js';

const SPEED_OPTIONS = [1, 2, 4, 8];

export function createSimGallery() {
  const instances = [];
  let speed = 1;
  let running = false;
  let rafId = null;
  let lastTime = 0;
  let accumulator = 0;
  const DT = 1 / 60;

  /** @type {function|null} */
  let onChange = null;

  function loop(nowMs) {
    rafId = requestAnimationFrame(loop);

    if (instances.length === 0) return;

    const now = nowMs / 1000;
    let elapsed = now - lastTime;
    lastTime = now;

    // Clamp to prevent spiral of death
    if (elapsed > 0.25) elapsed = 0.25;

    accumulator += elapsed;

    // Process fixed timesteps
    let stepsThisFrame = 0;
    const maxSteps = 5 * speed;
    while (accumulator >= DT && stepsThisFrame < maxSteps) {
      for (const inst of instances) {
        inst.tick();
      }
      accumulator -= DT;
      stepsThisFrame++;
    }

    // Render all instances
    for (const inst of instances) {
      inst.render();
    }
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = performance.now() / 1000;
    accumulator = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    if (!running) return;
    running = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  return {
    get instances() { return instances; },
    get speed() { return speed; },
    get running() { return running; },
    get speedOptions() { return SPEED_OPTIONS; },

    set onChange(fn) { onChange = fn; },

    async add(config = {}) {
      const instance = await createSimInstance(config);
      instances.push(instance);
      if (!running) start();
      if (onChange) onChange();
      return instance;
    },

    remove(id) {
      const idx = instances.findIndex(i => i.id === id);
      if (idx === -1) return;
      instances[idx].destroy();
      instances.splice(idx, 1);
      if (instances.length === 0) stop();
      if (onChange) onChange();
    },

    clear() {
      for (const inst of instances) {
        inst.destroy();
      }
      instances.length = 0;
      stop();
      if (onChange) onChange();
    },

    setSpeed(s) {
      if (SPEED_OPTIONS.includes(s)) {
        speed = s;
        if (onChange) onChange();
      }
    },

    /** Get state of all instances */
    getStates() {
      return instances.map(i => i.getState());
    },

    destroy() {
      this.clear();
    },

    listPolicies,
  };
}
