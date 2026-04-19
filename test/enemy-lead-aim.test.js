/**
 * Unit tests for first-order lead prediction used by enemy shooters.
 */

import { describe, it, expect } from 'vitest';
import { computeLeadAim } from '../src/systems/enemy-actions.js';

const EPS = 1e-6;

describe('computeLeadAim', () => {
  it('returns a unit vector', () => {
    const a = computeLeadAim(0, 0, 100, 0, 50, 0, 220);
    expect(Math.hypot(a.x, a.y)).toBeCloseTo(1, 6);
  });

  it('aims directly at a stationary target', () => {
    const a = computeLeadAim(0, 0, 200, 0, 0, 0, 220);
    expect(a.x).toBeCloseTo(1, 6);
    expect(a.y).toBeCloseTo(0, 6);
  });

  it('leads a target moving perpendicular to the line of sight', () => {
    // Enemy at origin, target at (300, 0) moving +y at 100 px/s, bullet 220 px/s.
    // Intercept time t satisfies |(300, 100t)| = 220t → 90000 + 10000 t² = 48400 t²
    // → t² = 90000 / 38400 ≈ 2.34375 → t ≈ 1.5309 s
    // Intercept point (300, 153.09) → aim y/x ratio ≈ 0.510
    const a = computeLeadAim(0, 0, 300, 0, 0, 100, 220);
    const t = Math.sqrt(90000 / (220 * 220 - 100 * 100));
    const expected = { x: 300, y: 100 * t };
    const len = Math.hypot(expected.x, expected.y);
    expect(a.x).toBeCloseTo(expected.x / len, 5);
    expect(a.y).toBeCloseTo(expected.y / len, 5);
    expect(a.y).toBeGreaterThan(0); // must lead forward, not back
  });

  it('leads further when the target moves faster (but slower than the bullet)', () => {
    const slow = computeLeadAim(0, 0, 300, 0, 0, 50, 220);
    const fast = computeLeadAim(0, 0, 300, 0, 0, 150, 220);
    expect(fast.y).toBeGreaterThan(slow.y);
    expect(slow.y).toBeGreaterThan(0);
  });

  it('falls back to direct aim when the target is as fast as the bullet', () => {
    // No real intercept — aim directly at current position.
    const a = computeLeadAim(0, 0, 300, 0, 0, 220, 220);
    expect(a.x).toBeCloseTo(1, 6);
    expect(Math.abs(a.y)).toBeLessThan(EPS);
  });

  it('falls back to direct aim when the target is faster than the bullet', () => {
    const a = computeLeadAim(0, 0, 300, 0, 0, 400, 220);
    expect(a.x).toBeCloseTo(1, 6);
    expect(Math.abs(a.y)).toBeLessThan(EPS);
  });

  it('intercept is actually reached (closed-form verification)', () => {
    // For a chosen scenario, walk the bullet at computed aim and the target at its
    // velocity forward in time; they must meet within a small epsilon at some t>0.
    const ex = 100, ey = 50;
    const px = 400, py = 300;
    const pvx = -30, pvy = 80;
    const speed = 220;
    const aim = computeLeadAim(ex, ey, px, py, pvx, pvy, speed);
    // Solve for t from the bullet's equation: bullet at (ex + aim*speed*t).
    // Distance from enemy to predicted intercept:
    const a = pvx * pvx + pvy * pvy - speed * speed;
    const b = 2 * ((px - ex) * pvx + (py - ey) * pvy);
    const c = (px - ex) ** 2 + (py - ey) ** 2;
    const disc = b * b - 4 * a * c;
    const sq = Math.sqrt(disc);
    const t1 = (-b + sq) / (2 * a);
    const t2 = (-b - sq) / (2 * a);
    const t = (t1 > 0 && (t2 <= 0 || t1 < t2)) ? t1 : t2;
    expect(t).toBeGreaterThan(0);
    const bulletX = ex + aim.x * speed * t;
    const bulletY = ey + aim.y * speed * t;
    const targetX = px + pvx * t;
    const targetY = py + pvy * t;
    expect(Math.hypot(bulletX - targetX, bulletY - targetY)).toBeLessThan(1e-3);
  });

  it('is deterministic', () => {
    const a = computeLeadAim(0, 0, 250, -120, 40, 60, 220);
    const b = computeLeadAim(0, 0, 250, -120, 40, 60, 220);
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
  });

  it('does not throw or return NaN when enemy and target coincide', () => {
    // Degenerate in practice — collision resolves first. Just ensure stability.
    const a = computeLeadAim(100, 100, 100, 100, 0, 0, 220);
    expect(Number.isFinite(a.x)).toBe(true);
    expect(Number.isFinite(a.y)).toBe(true);
  });
});
