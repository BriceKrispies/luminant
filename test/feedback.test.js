/**
 * Feedback system tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFeedbackSystem } from '../src/systems/feedback.js';
import { clearEffects } from '../src/renderer/effects.js';

// Minimal stubs for camera and clock
function stubCamera() {
  return {
    x: 100, y: 100,
    shakes: [],
    impulses: [],
    addShake(intensity) { this.shakes.push(intensity); },
    addImpulse(fx, fy, strength) { this.impulses.push({ fx, fy, strength }); },
  };
}

function stubClock() {
  return {
    freezes: [],
    addFreeze(frames) { this.freezes.push(frames); },
  };
}

let camera, clock, feedback;

beforeEach(() => {
  camera = stubCamera();
  clock = stubClock();
  feedback = createFeedbackSystem(null, { camera, clock });
  clearEffects();
});

describe('Hit events', () => {
  it('adds shake on hit', () => {
    feedback.emit({ type: 'hit', x: 120, y: 100, magnitude: 30 });
    feedback.update(1 / 60);

    expect(camera.shakes.length).toBe(1);
    expect(camera.shakes[0]).toBeGreaterThan(0);
  });

  it('adds impulse away from hit position', () => {
    feedback.emit({ type: 'hit', x: 120, y: 100, magnitude: 40 });
    feedback.update(1 / 60);

    expect(camera.impulses.length).toBe(1);
    expect(camera.impulses[0].strength).toBeGreaterThan(0);
  });

  it('scales shake with magnitude', () => {
    feedback.emit({ type: 'hit', x: 100, y: 100, magnitude: 10 });
    feedback.update(1 / 60);
    const lowShake = camera.shakes[0];

    feedback.emit({ type: 'hit', x: 100, y: 100, magnitude: 60 });
    feedback.update(1 / 60);
    const highShake = camera.shakes[1];

    expect(highShake).toBeGreaterThan(lowShake);
  });
});

describe('Death events', () => {
  it('adds shake on death', () => {
    feedback.emit({ type: 'death', x: 50, y: 50, magnitude: 1 });
    feedback.update(1 / 60);

    expect(camera.shakes.length).toBe(1);
    expect(camera.shakes[0]).toBeGreaterThan(0);
  });

  it('triggers hit stop on strong deaths', () => {
    feedback.emit({ type: 'death', x: 50, y: 50, magnitude: 2 });
    feedback.update(1 / 60);

    expect(clock.freezes.length).toBe(1);
    expect(clock.freezes[0]).toBe(2);
  });

  it('does not trigger hit stop on weak deaths', () => {
    feedback.emit({ type: 'death', x: 50, y: 50, magnitude: 1 });
    feedback.update(1 / 60);

    expect(clock.freezes.length).toBe(0);
  });
});

describe('Level-up events', () => {
  it('adds strong shake on level-up', () => {
    feedback.emit({ type: 'levelup', x: 200, y: 200 });
    feedback.update(1 / 60);

    expect(camera.shakes.length).toBe(1);
    expect(camera.shakes[0]).toBe(6);
  });
});

describe('Queue behavior', () => {
  it('processes multiple events in one update', () => {
    feedback.emit({ type: 'hit', x: 10, y: 10, magnitude: 20 });
    feedback.emit({ type: 'hit', x: 20, y: 20, magnitude: 20 });
    feedback.emit({ type: 'death', x: 30, y: 30, magnitude: 1 });
    feedback.update(1 / 60);

    // 2 hit shakes + 1 death shake
    expect(camera.shakes.length).toBe(3);
  });

  it('queue is empty after update', () => {
    feedback.emit({ type: 'hit', x: 10, y: 10, magnitude: 20 });
    feedback.update(1 / 60);
    feedback.update(1 / 60);

    // Should not duplicate — only 1 shake total
    expect(camera.shakes.length).toBe(1);
  });

  it('reset clears pending events', () => {
    feedback.emit({ type: 'hit', x: 10, y: 10, magnitude: 20 });
    feedback.reset();
    feedback.update(1 / 60);

    expect(camera.shakes.length).toBe(0);
  });
});
