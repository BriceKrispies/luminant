/**
 * Combat feedback system.
 * Coordinates screen shake, visual effects, and hit stop
 * in response to gameplay events (hits, deaths, level-ups).
 * Event-driven: game systems emit events, feedback routes them.
 */

import { addEffect } from '../renderer/effects.js';

export function createFeedbackSystem(engine, deps) {
  const { camera, clock } = deps;
  const queue = [];

  return {
    emit(event) {
      queue.push(event);
    },

    update(dt) {
      while (queue.length > 0) {
        const ev = queue.pop();
        if (ev.type === 'hit') {
          handleHit(ev, camera);
        } else if (ev.type === 'death') {
          handleDeath(ev, camera, clock);
        } else if (ev.type === 'levelup') {
          handleLevelUp(ev, camera);
        }
      }
    },

    reset() {
      queue.length = 0;
    },
  };
}

function handleHit(ev, camera) {
  const mag = ev.magnitude || 1;
  // Scale shake with damage — light hits barely shake
  camera.addShake(Math.min(mag / 15, 4));
  // Directional impulse away from hit point toward camera center
  if (ev.x !== undefined && ev.y !== undefined) {
    camera.addImpulse(ev.x, ev.y, Math.min(mag / 20, 2));
  }
  addEffect('hit', ev.x, ev.y, {
    duration: 0.2,
    magnitude: mag,
  });
}

function handleDeath(ev, camera, clock) {
  const mag = ev.magnitude || 1;
  camera.addShake(3 * mag);
  addEffect('death', ev.x, ev.y, {
    duration: 0.35,
    magnitude: mag,
  });
  // Strong deaths get a brief hit stop
  if (mag >= 2 && clock) {
    clock.addFreeze(2);
  }
}

function handleLevelUp(ev, camera) {
  camera.addShake(6);
  addEffect('levelup', ev.x, ev.y, { duration: 0.6 });
}
