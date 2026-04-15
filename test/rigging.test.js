/**
 * Tests for the skeleton-based creature rigging system.
 *
 * Covers: skeleton hierarchy, pose operations, clip sampling, animation controller,
 * slot/attachment resolution, overlay composition, secondary motion determinism,
 * expression controller, skin resolution, rig data integrity, and integrated
 * resolver pipeline (skeleton path).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createSkeleton, createPose, resetPose, copyPose, blendPoses, addPose, solveWorldPose, getPoseBone, setPoseBone, setPoseBonePartial, POSE_STRIDE, PX, PY, PROT, PSX, PSY } from '../src/renderer/creatures/skeleton.js';
import { createClip, createTrack, kf, sampleTrack, sampleClip, getClipProgress, isClipFinished } from '../src/renderer/creatures/animation.js';
import { createAnimController } from '../src/renderer/creatures/anim-controller.js';
import { createSlotLayout, resolveAttachments, attachment } from '../src/renderer/creatures/slots.js';
import { breathingOverlay, hoverBobOverlay, recoilOverlay, tensionOverlay, headLookOverlay, createOverlayStack } from '../src/renderer/creatures/overlays.js';
import { createSecondary, getSecondary } from '../src/renderer/creatures/secondaries.js';
import { createExpressionController, detectExpression } from '../src/renderer/creatures/expression.js';
import { resolveSkin, createDefaultSkin, registerSkin, getSkin } from '../src/renderer/creatures/skins.js';
import { SKELETON_DEFS, SLOT_DEFS, CLIP_DEFS, STATE_CONFIGS, EXPRESSION_PROFILES, OVERLAY_CONFIGS } from '../src/renderer/creatures/rig-data.js';
import { createCreatureResolver } from '../src/renderer/creatures/creature-model.js';
import { ARCHETYPES } from '../src/renderer/creatures/archetypes.js';
import { TYPE, STATE } from '../src/engine/bindings.js';

// ── Helpers ──

const SIMPLE_BONES = [
  { name: 'root', parent: null, x: 0, y: 0 },
  { name: 'body', parent: 'root', x: 0, y: -5 },
  { name: 'head', parent: 'body', x: 0, y: -3 },
  { name: 'left_arm', parent: 'body', x: -2, y: 0 },
  { name: 'right_arm', parent: 'body', x: 2, y: 0 },
];

function makeEntity(overrides = {}) {
  return {
    id: 1, x: 100, y: 200, vx: 0, vy: 0,
    hp: 30, maxHp: 30, type: TYPE.ENEMY_BASIC,
    state: STATE.ACTIVE, radius: 10, damage: 8,
    speed: 60, facing: 0,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════
//  Skeleton
// ══════════════════════════════════════════════════════════

describe('Skeleton', () => {
  it('creates a skeleton with correct bone count', () => {
    const skel = createSkeleton('test', SIMPLE_BONES);
    expect(skel.boneCount).toBe(5);
    expect(skel.id).toBe('test');
  });

  it('resolves bone indices by name', () => {
    const skel = createSkeleton('test', SIMPLE_BONES);
    expect(skel.getBoneIndex('root')).toBe(0);
    expect(skel.getBoneIndex('head')).toBe(2);
    expect(skel.getBoneIndex('nonexistent')).toBe(-1);
  });

  it('stores parent indices correctly', () => {
    const skel = createSkeleton('test', SIMPLE_BONES);
    expect(skel.bones[0].parentIndex).toBe(-1); // root
    expect(skel.bones[1].parentIndex).toBe(0);  // body→root
    expect(skel.bones[2].parentIndex).toBe(1);  // head→body
    expect(skel.bones[3].parentIndex).toBe(1);  // left_arm→body
  });

  it('stores default transforms', () => {
    const skel = createSkeleton('test', SIMPLE_BONES);
    expect(skel.bones[1].defaultY).toBe(-5);
    expect(skel.bones[3].defaultX).toBe(-2);
  });

  it('throws on unknown parent', () => {
    expect(() => createSkeleton('bad', [
      { name: 'child', parent: 'missing', x: 0, y: 0 },
    ])).toThrow('unknown parent');
  });

  it('supports bone tags', () => {
    const skel = createSkeleton('test', [
      { name: 'root', parent: null, x: 0, y: 0, tags: 'body' },
      { name: 'head', parent: 'root', x: 0, y: -3, tags: 'face,anchor' },
    ]);
    expect(skel.boneHasTag(0, 'body')).toBe(true);
    expect(skel.boneHasTag(1, 'face')).toBe(true);
    expect(skel.boneHasTag(1, 'anchor')).toBe(true);
    expect(skel.boneHasTag(0, 'face')).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
//  Pose operations
// ══════════════════════════════════════════════════════════

describe('Pose operations', () => {
  let skel, pose;

  beforeEach(() => {
    skel = createSkeleton('test', SIMPLE_BONES);
    pose = createPose(skel);
  });

  it('creates pose with correct size', () => {
    expect(pose.length).toBe(5 * POSE_STRIDE);
  });

  it('initializes pose to skeleton defaults', () => {
    // body bone default y = -5
    const bodyOff = 1 * POSE_STRIDE;
    expect(pose[bodyOff + PY]).toBe(-5);
    expect(pose[bodyOff + PSX]).toBe(1);
    expect(pose[bodyOff + PSY]).toBe(1);
  });

  it('resetPose restores defaults', () => {
    pose[1 * POSE_STRIDE + PX] = 999;
    resetPose(skel, pose);
    expect(pose[1 * POSE_STRIDE + PX]).toBe(0);
  });

  it('copyPose duplicates values', () => {
    pose[0] = 42;
    const copy = new Float64Array(pose.length);
    copyPose(copy, pose);
    expect(copy[0]).toBe(42);
  });

  it('blendPoses interpolates linearly', () => {
    const a = createPose(skel);
    const b = createPose(skel);
    b[0 + PX] = 10;
    const out = new Float64Array(a.length);
    blendPoses(out, a, b, 0.5);
    expect(out[0 + PX]).toBe(5);
  });

  it('addPose applies additively for translation/rotation', () => {
    const delta = new Float64Array(skel.boneCount * POSE_STRIDE);
    // Init delta to identity
    for (let i = 0; i < delta.length; i += POSE_STRIDE) {
      delta[i + PSX] = 1;
      delta[i + PSY] = 1;
    }
    delta[0 + PX] = 3;
    delta[0 + PROT] = 0.1;
    addPose(pose, delta, 1);
    expect(pose[0 + PX]).toBe(3); // root default x=0, + 3
    expect(pose[0 + PROT]).toBeCloseTo(0.1);
  });

  it('addPose applies multiplicatively for scale', () => {
    const delta = new Float64Array(skel.boneCount * POSE_STRIDE);
    for (let i = 0; i < delta.length; i += POSE_STRIDE) {
      delta[i + PSX] = 1;
      delta[i + PSY] = 1;
    }
    // Scale body by 1.5
    delta[1 * POSE_STRIDE + PSX] = 1.5;
    addPose(pose, delta, 1);
    expect(pose[1 * POSE_STRIDE + PSX]).toBeCloseTo(1.5);
  });

  it('getPoseBone and setPoseBone round-trip', () => {
    setPoseBone(pose, 0, 1, 2, 0.5, 1.1, 0.9);
    const b = getPoseBone(pose, 0);
    expect(b.x).toBe(1);
    expect(b.y).toBe(2);
    expect(b.rotation).toBe(0.5);
    expect(b.scaleX).toBeCloseTo(1.1);
    expect(b.scaleY).toBeCloseTo(0.9);
  });

  it('setPoseBonePartial updates only specified fields', () => {
    resetPose(skel, pose);
    setPoseBonePartial(pose, 0, { x: 7 });
    const b = getPoseBone(pose, 0);
    expect(b.x).toBe(7);
    expect(b.y).toBe(0); // unchanged
  });
});

// ══════════════════════════════════════════════════════════
//  World transform solver
// ══════════════════════════════════════════════════════════

describe('World transform solver', () => {
  it('root bone gets entity position', () => {
    const skel = createSkeleton('test', SIMPLE_BONES);
    const local = createPose(skel);
    const world = new Float64Array(skel.boneCount * POSE_STRIDE);
    solveWorldPose(skel, local, world, 100, 200, 0, 1);
    expect(world[0 + PX]).toBe(100);
    expect(world[0 + PY]).toBe(200);
  });

  it('child bones inherit parent transforms', () => {
    const skel = createSkeleton('test', SIMPLE_BONES);
    const local = createPose(skel);
    const world = new Float64Array(skel.boneCount * POSE_STRIDE);
    solveWorldPose(skel, local, world, 0, 0, 0, 1);

    // body is at (0, -5) local, root at (0,0) → world (0, -5)
    expect(world[1 * POSE_STRIDE + PX]).toBeCloseTo(0);
    expect(world[1 * POSE_STRIDE + PY]).toBeCloseTo(-5);

    // head is at (0, -3) local relative to body → world (0, -8)
    expect(world[2 * POSE_STRIDE + PX]).toBeCloseTo(0);
    expect(world[2 * POSE_STRIDE + PY]).toBeCloseTo(-8);
  });

  it('applies root scale to all descendants', () => {
    const skel = createSkeleton('test', SIMPLE_BONES);
    const local = createPose(skel);
    const world = new Float64Array(skel.boneCount * POSE_STRIDE);
    solveWorldPose(skel, local, world, 0, 0, 0, 2);

    // body at (0, -5) scaled by 2 → world (0, -10)
    expect(world[1 * POSE_STRIDE + PY]).toBeCloseTo(-10);
    expect(world[1 * POSE_STRIDE + PSX]).toBeCloseTo(2);
  });

  it('applies root rotation', () => {
    const skel = createSkeleton('test', [
      { name: 'root', parent: null, x: 0, y: 0 },
      { name: 'child', parent: 'root', x: 1, y: 0 },
    ]);
    const local = createPose(skel);
    const world = new Float64Array(skel.boneCount * POSE_STRIDE);
    solveWorldPose(skel, local, world, 0, 0, Math.PI / 2, 1);

    // child at (1,0) rotated 90° → (0, 1)
    expect(world[1 * POSE_STRIDE + PX]).toBeCloseTo(0, 5);
    expect(world[1 * POSE_STRIDE + PY]).toBeCloseTo(1, 5);
  });
});

// ══════════════════════════════════════════════════════════
//  Animation clips and sampling
// ══════════════════════════════════════════════════════════

describe('Animation clips', () => {
  it('creates a clip with sorted keyframes', () => {
    const track = createTrack('body', 'x', [
      kf(0.5, 10), kf(0, 0), kf(1, 20),
    ]);
    expect(track.keyframes[0].time).toBe(0);
    expect(track.keyframes[1].time).toBe(0.5);
    expect(track.keyframes[2].time).toBe(1);
  });

  it('sampleTrack interpolates between keyframes', () => {
    const track = createTrack('body', 'x', [kf(0, 0), kf(1, 10)]);
    expect(sampleTrack(track, 0.5)).toBe(5);
    expect(sampleTrack(track, 0)).toBe(0);
    expect(sampleTrack(track, 1)).toBe(10);
  });

  it('sampleTrack clamps outside range', () => {
    const track = createTrack('body', 'x', [kf(0.2, 5), kf(0.8, 15)]);
    expect(sampleTrack(track, 0)).toBe(5);
    expect(sampleTrack(track, 1)).toBe(15);
  });

  it('sampleTrack applies easing', () => {
    const track = createTrack('body', 'x', [kf(0, 0), kf(1, 100, 'ease-in')]);
    const mid = sampleTrack(track, 0.5);
    // ease-in at t=0.5 → t²=0.25, so value should be 25
    expect(mid).toBeCloseTo(25);
  });

  it('sampleClip writes pose delta for translation (additive)', () => {
    const skel = createSkeleton('test', SIMPLE_BONES);
    const clip = createClip('test', 1.0, false, [
      createTrack('body', 'x', [kf(0, 0), kf(1, 10)]),
    ]);
    const outPose = new Float64Array(skel.boneCount * POSE_STRIDE);
    sampleClip(clip, 0.5, skel, outPose);

    const bodyIdx = skel.getBoneIndex('body');
    expect(outPose[bodyIdx * POSE_STRIDE + PX]).toBe(5);
    // Other properties should be identity
    expect(outPose[bodyIdx * POSE_STRIDE + PSX]).toBe(1);
  });

  it('sampleClip handles looping', () => {
    const skel = createSkeleton('test', SIMPLE_BONES);
    const clip = createClip('loop', 2.0, true, [
      createTrack('body', 'x', [kf(0, 0), kf(1, 10)]),
    ]);
    const out = new Float64Array(skel.boneCount * POSE_STRIDE);

    // At time=3.0 with duration=2.0, normalized = 0.5
    sampleClip(clip, 3.0, skel, out);
    const bodyIdx = skel.getBoneIndex('body');
    expect(out[bodyIdx * POSE_STRIDE + PX]).toBe(5);
  });

  it('getClipProgress returns correct ratio', () => {
    const clip = createClip('test', 2.0, false, []);
    expect(getClipProgress(clip, 1.0)).toBeCloseTo(0.5);
    expect(getClipProgress(clip, 3.0)).toBe(1); // clamped
  });

  it('isClipFinished works for non-looping clips', () => {
    const clip = createClip('test', 1.0, false, []);
    expect(isClipFinished(clip, 0.5)).toBe(false);
    expect(isClipFinished(clip, 1.0)).toBe(true);
    expect(isClipFinished(clip, 2.0)).toBe(true);
  });

  it('isClipFinished returns false for looping clips', () => {
    const clip = createClip('test', 1.0, true, []);
    expect(isClipFinished(clip, 10.0)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
//  Animation controller
// ══════════════════════════════════════════════════════════

describe('Animation controller', () => {
  let clips, stateConfigs, ctrl;

  beforeEach(() => {
    clips = {
      idle: createClip('idle', 2.0, true, []),
      locomotion: createClip('locomotion', 0.5, true, []),
      hit_react: createClip('hit_react', 0.2, false, []),
      dying: createClip('dying', 0.5, false, []),
    };
    stateConfigs = {
      idle: { clip: 'idle', loop: true, blendIn: 0.1 },
      locomotion: { clip: 'locomotion', loop: true, blendIn: 0.1 },
      hit_react: { clip: 'hit_react', loop: false, next: 'idle', blendIn: 0.05, priority: 2 },
      dying: { clip: 'dying', loop: false, blendIn: 0.05, priority: 3 },
    };
    ctrl = createAnimController(stateConfigs, clips, 'idle');
  });

  it('starts in initial state', () => {
    expect(ctrl.state).toBe('idle');
  });

  it('auto-transitions to locomotion when entity moves', () => {
    const entity = makeEntity({ vx: 50, vy: 0 });
    ctrl.update(1 / 60, entity);
    expect(ctrl.state).toBe('locomotion');
  });

  it('returns to idle when entity stops', () => {
    const moving = makeEntity({ vx: 50, vy: 0 });
    ctrl.update(1 / 60, moving);
    expect(ctrl.state).toBe('locomotion');

    const stopped = makeEntity({ vx: 0, vy: 0 });
    ctrl.update(1 / 60, stopped);
    expect(ctrl.state).toBe('idle');
  });

  it('playOneShot interrupts and returns to base', () => {
    const entity = makeEntity();
    ctrl.playOneShot('hit_react');
    ctrl.update(1 / 60, entity);
    expect(ctrl.state).toBe('hit_react');

    // After clip finishes (0.2s), should return
    for (let i = 0; i < 20; i++) ctrl.update(1 / 60, entity);
    expect(ctrl.state).toBe('idle');
  });

  it('higher priority one-shot can interrupt lower', () => {
    ctrl.playOneShot('hit_react');
    ctrl.update(1 / 60, makeEntity());
    expect(ctrl.state).toBe('hit_react');
    // dying has higher priority
    ctrl.playOneShot('dying');
    ctrl.update(1 / 60, makeEntity({ state: STATE.DYING }));
    expect(ctrl.state).toBe('dying');
  });

  it('getPlayback returns clip layers', () => {
    ctrl.update(1 / 60, makeEntity());
    const pb = ctrl.getPlayback();
    expect(pb.layers.length).toBeGreaterThan(0);
    expect(pb.layers[0].clip).toBeDefined();
    expect(pb.layers[0].weight).toBe(1);
  });

  it('crossfade produces two layers during transition', () => {
    const entity = makeEntity({ vx: 50, vy: 0 });
    ctrl.update(1 / 60, entity); // transition idle→locomotion
    if (ctrl.isBlending) {
      const pb = ctrl.getPlayback();
      expect(pb.layers.length).toBe(2);
      const totalWeight = pb.layers[0].weight + pb.layers[1].weight;
      expect(totalWeight).toBeCloseTo(1);
    }
  });

  it('reset returns to initial state', () => {
    ctrl.playOneShot('hit_react');
    ctrl.update(1 / 60, makeEntity());
    ctrl.reset();
    expect(ctrl.state).toBe('idle');
    expect(ctrl.time).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════
//  Slots and attachments
// ══════════════════════════════════════════════════════════

describe('Slots and attachments', () => {
  let skel, slotDefs;

  beforeEach(() => {
    skel = createSkeleton('test', SIMPLE_BONES);
    slotDefs = [
      { name: 'body_shape', bone: 'body', drawOrder: 0, attachments: [
        attachment.shape('blob', { segments: 12 }),
      ]},
      { name: 'eye_left', bone: 'head', drawOrder: 10, attachments: [
        attachment.eye('dot', { side: 'left' }),
      ]},
      { name: 'glow', bone: 'root', drawOrder: -10, attachments: [
        attachment.accent('glow', { radius: 2.5 }),
      ]},
    ];
  });

  it('createSlotLayout resolves bone indices', () => {
    const layout = createSlotLayout(slotDefs, skel);
    expect(layout.slots[0].boneIndex).toBe(skel.getBoneIndex('body'));
    expect(layout.slots[1].boneIndex).toBe(skel.getBoneIndex('head'));
  });

  it('createSlotLayout pre-computes draw order', () => {
    const layout = createSlotLayout(slotDefs, skel);
    const ordered = layout.drawOrderedIndices;
    // glow (-10) should come before body (0) which comes before eye (10)
    const glowIdx = layout.getSlotIndex('glow');
    const bodyIdx = layout.getSlotIndex('body_shape');
    const eyeIdx = layout.getSlotIndex('eye_left');
    const glowPos = ordered.indexOf(glowIdx);
    const bodyPos = ordered.indexOf(bodyIdx);
    const eyePos = ordered.indexOf(eyeIdx);
    expect(glowPos).toBeLessThan(bodyPos);
    expect(bodyPos).toBeLessThan(eyePos);
  });

  it('resolveAttachments returns draw-ordered slots', () => {
    const layout = createSlotLayout(slotDefs, skel);
    const resolved = resolveAttachments(layout);
    expect(resolved.length).toBe(3);
    expect(resolved[0].name).toBe('glow'); // lowest draw order
  });

  it('skin overrides replace slot attachments', () => {
    const layout = createSlotLayout(slotDefs, skel);
    const skinOverrides = {
      'body_shape': [attachment.shape('wisp_body', { segments: 16 })],
    };
    const resolved = resolveAttachments(layout, skinOverrides);
    const bodySlot = resolved.find(s => s.name === 'body_shape');
    expect(bodySlot.attachments[0].params.shape).toBe('wisp_body');
  });

  it('temp overrides can hide slots', () => {
    const layout = createSlotLayout(slotDefs, skel);
    const tempOverrides = { 'eye_left': { visible: false } };
    const resolved = resolveAttachments(layout, null, null, tempOverrides);
    const eyeSlot = resolved.find(s => s.name === 'eye_left');
    expect(eyeSlot.attachments.length).toBe(0);
  });

  it('attachment builders set correct types', () => {
    expect(attachment.shape('blob').type).toBe('shape');
    expect(attachment.eye('dot').type).toBe('eye');
    expect(attachment.feature('highlight').type).toBe('feature');
    expect(attachment.accent('glow').type).toBe('accent');
    expect(attachment.fx('particle').type).toBe('fx');
  });

  it('deformable flag is preserved', () => {
    const att = attachment.accent('trail', { deformable: true, deformParams: { type: 'wave' } });
    expect(att.deformable).toBe(true);
    expect(att.deformParams.type).toBe('wave');
  });
});

// ══════════════════════════════════════════════════════════
//  Overlays
// ══════════════════════════════════════════════════════════

describe('Overlays', () => {
  let skel, pose;

  beforeEach(() => {
    skel = createSkeleton('test', SIMPLE_BONES);
    pose = createPose(skel);
  });

  it('breathing overlay modifies body scale', () => {
    const overlay = breathingOverlay({ amp: 0.1, freq: 1.0, bones: ['body'] });
    const before = pose[1 * POSE_STRIDE + PSX];
    overlay.apply(pose, skel, 0.25, 1 / 60, { weight: 1, phase: 0 });
    const after = pose[1 * POSE_STRIDE + PSX];
    expect(after).not.toBe(before);
  });

  it('hover_bob overlay modifies root Y', () => {
    const overlay = hoverBobOverlay({ amp: 3, freq: 1.0, bone: 'root' });
    overlay.apply(pose, skel, 0.25, 1 / 60, { weight: 1, phase: 0 });
    expect(pose[0 * POSE_STRIDE + PY]).not.toBe(0);
  });

  it('recoil overlay is inactive when intensity=0', () => {
    const overlay = recoilOverlay();
    const before = pose[1 * POSE_STRIDE + PY];
    overlay.apply(pose, skel, 0, 1 / 60, { intensity: 0 });
    expect(pose[1 * POSE_STRIDE + PY]).toBe(before);
  });

  it('recoil overlay shifts body when intensity>0', () => {
    const overlay = recoilOverlay({ magnitude: 5, bone: 'body' });
    overlay.apply(pose, skel, 0, 1 / 60, { intensity: 0.8 });
    // Should have shifted Y
    expect(pose[1 * POSE_STRIDE + PY]).not.toBe(-5);
  });

  it('overlay stack applies all overlays', () => {
    const stack = createOverlayStack();
    stack.add(breathingOverlay({ amp: 0.1, freq: 1.0, bones: ['body'] }));
    stack.add(hoverBobOverlay({ amp: 3, freq: 1.0 }));

    const beforeBody = pose[1 * POSE_STRIDE + PSX];
    const beforeRoot = pose[0 * POSE_STRIDE + PY];
    stack.applyAll(pose, skel, 0.25, 1 / 60);

    expect(pose[1 * POSE_STRIDE + PSX]).not.toBe(beforeBody);
    expect(pose[0 * POSE_STRIDE + PY]).not.toBe(beforeRoot);
  });

  it('overlay stack setParams updates correctly', () => {
    const stack = createOverlayStack();
    stack.add(recoilOverlay(), { intensity: 0 });
    stack.setParams('recoil', { intensity: 1.0 });
    expect(stack.getParams('recoil').intensity).toBe(1.0);
  });
});

// ══════════════════════════════════════════════════════════
//  Secondary motion
// ══════════════════════════════════════════════════════════

describe('Secondary motion modules', () => {
  let skel, pose;

  beforeEach(() => {
    skel = createSkeleton('ghost', SKELETON_DEFS.ghost);
    pose = createPose(skel);
  });

  it('ghost secondary exists', () => {
    expect(getSecondary('ghost')).toBeDefined();
  });

  it('ember secondary exists', () => {
    expect(getSecondary('ember')).toBeDefined();
  });

  it('brute secondary exists', () => {
    expect(getSecondary('brute')).toBeDefined();
  });

  it('slime secondary exists', () => {
    expect(getSecondary('slime')).toBeDefined();
  });

  it('createSecondary returns null for unknown ID', () => {
    expect(createSecondary('nonexistent')).toBeNull();
  });

  it('ghost secondary modifies body drift', () => {
    const secondary = createSecondary('ghost');
    const bodyIdx = skel.getBoneIndex('body');
    const before = pose[bodyIdx * POSE_STRIDE + PX];
    const entity = makeEntity({ vx: 20, vy: 10 });
    const variation = { wobblePhase: 1.5 };
    secondary.apply(pose, skel, entity, 1.0, 1 / 60, variation);
    expect(pose[bodyIdx * POSE_STRIDE + PX]).not.toBe(before);
  });

  it('secondary motion is deterministic for same inputs', () => {
    const s1 = createSecondary('ghost');
    const s2 = createSecondary('ghost');
    const p1 = createPose(skel);
    const p2 = createPose(skel);
    const entity = makeEntity({ vx: 20, vy: 0 });
    const variation = { wobblePhase: 1.0 };

    s1.apply(p1, skel, entity, 1.0, 1 / 60, variation);
    s2.apply(p2, skel, entity, 1.0, 1 / 60, variation);

    for (let i = 0; i < p1.length; i++) {
      expect(p1[i]).toBe(p2[i]);
    }
  });
});

// ══════════════════════════════════════════════════════════
//  Expression controller
// ══════════════════════════════════════════════════════════

describe('Expression controller', () => {
  let controller;

  beforeEach(() => {
    controller = createExpressionController(EXPRESSION_PROFILES.ghost, 42);
  });

  it('starts at neutral', () => {
    expect(controller.expression).toBe('neutral');
    expect(controller.target).toBe('neutral');
  });

  it('sets target expression', () => {
    controller.setExpression('angry');
    expect(controller.target).toBe('angry');
  });

  it('blends toward target over time', () => {
    controller.setExpression('angry');
    controller.update(0.5);
    const params = controller.getParams();
    // Should be partially blended
    expect(params.blendT).toBeGreaterThan(0);
  });

  it('eventually reaches target expression', () => {
    controller.setExpression('angry');
    for (let i = 0; i < 30; i++) controller.update(1 / 60);
    expect(controller.expression).toBe('angry');
    const params = controller.getParams();
    expect(params.blendT).toBe(1);
  });

  it('blink timer fires automatically', () => {
    // Advance time until a blink occurs
    let blinked = false;
    for (let i = 0; i < 600; i++) {
      controller.update(1 / 60);
      if (controller.isBlinking) {
        blinked = true;
        break;
      }
    }
    expect(blinked).toBe(true);
  });

  it('blinkAmount returns 0 when not blinking', () => {
    // Fresh controller, before first blink
    expect(controller.blinkAmount).toBe(0);
  });

  it('ignores unknown expressions', () => {
    controller.setExpression('nonexistent');
    expect(controller.target).toBe('neutral');
  });

  it('no blink during dead expression', () => {
    controller.setExpression('dead');
    for (let i = 0; i < 100; i++) controller.update(1 / 60);
    expect(controller.isBlinking).toBe(false);
  });

  it('pupil bias is settable', () => {
    controller.setPupilBias(0.5, -0.3);
    expect(controller.pupilX).toBe(0.5);
    expect(controller.pupilY).toBe(-0.3);
  });

  it('reset returns to neutral', () => {
    controller.setExpression('angry');
    controller.update(0.5);
    controller.reset();
    expect(controller.expression).toBe('neutral');
    expect(controller.target).toBe('neutral');
    expect(controller.pupilX).toBe(0);
  });
});

describe('detectExpression', () => {
  it('returns dead for dying entity', () => {
    expect(detectExpression({ state: 2 }, 0, 'idle')).toBe('dead');
  });

  it('returns hurt when hit timer active', () => {
    expect(detectExpression({ state: 1 }, 0.1, 'idle')).toBe('hurt');
  });

  it('returns angry during attack', () => {
    expect(detectExpression({ state: 1 }, 0, 'attack')).toBe('angry');
  });

  it('returns focused during locomotion', () => {
    expect(detectExpression({ state: 1 }, 0, 'locomotion')).toBe('focused');
  });

  it('returns neutral by default', () => {
    expect(detectExpression({ state: 1 }, 0, 'idle')).toBe('neutral');
  });
});

// ══════════════════════════════════════════════════════════
//  Skins
// ══════════════════════════════════════════════════════════

describe('Skin system', () => {
  it('createDefaultSkin creates from archetype', () => {
    const skin = createDefaultSkin(ARCHETYPES.slime);
    expect(skin.id).toBe('slime_default');
    expect(skin.skeletonId).toBe('slime');
    expect(skin.palette).toEqual(ARCHETYPES.slime.palette);
  });

  it('resolveSkin merges palette overrides', () => {
    const arch = ARCHETYPES.ghost;
    const skin = {
      id: 'ghost_alt',
      palette: { base: [1, 0, 0] },
    };
    const resolved = resolveSkin(arch, skin);
    expect(resolved.palette.base).toEqual([1, 0, 0]);
    expect(resolved.palette.highlight).toEqual(arch.palette.highlight); // inherited
  });

  it('resolveSkin uses archetype secondaryId as fallback', () => {
    const arch = { ...ARCHETYPES.slime };
    const skin = { id: 'test' };
    const resolved = resolveSkin(arch, skin);
    expect(resolved.secondaryId).toBe('slime');
  });

  it('registerSkin and getSkin round-trip', () => {
    registerSkin('test_skin', { id: 'test_skin', palette: {} });
    expect(getSkin('test_skin')).toBeDefined();
    expect(getSkin('test_skin').id).toBe('test_skin');
  });
});

// ══════════════════════════════════════════════════════════
//  Rig data integrity
// ══════════════════════════════════════════════════════════

describe('Rig data integrity', () => {
  const archetypeIds = ['ghost', 'ember', 'brute', 'slime'];

  it('all archetypes have skeleton definitions', () => {
    for (const id of archetypeIds) {
      expect(SKELETON_DEFS[id]).toBeDefined();
      expect(SKELETON_DEFS[id].length).toBeGreaterThan(3);
      // First bone must be root with no parent
      expect(SKELETON_DEFS[id][0].name).toBe('root');
      expect(SKELETON_DEFS[id][0].parent).toBeNull();
    }
  });

  it('all archetypes have slot definitions', () => {
    for (const id of archetypeIds) {
      expect(SLOT_DEFS[id]).toBeDefined();
      expect(SLOT_DEFS[id].length).toBeGreaterThan(0);
    }
  });

  it('all archetypes have clip definitions', () => {
    for (const id of archetypeIds) {
      const clips = CLIP_DEFS[id];
      expect(clips).toBeDefined();
      expect(clips.idle).toBeDefined();
      expect(clips.locomotion).toBeDefined();
      expect(clips.attack).toBeDefined();
      expect(clips.hit_react).toBeDefined();
      expect(clips.dying).toBeDefined();
    }
  });

  it('all archetypes have expression profiles', () => {
    for (const id of archetypeIds) {
      const profile = EXPRESSION_PROFILES[id];
      expect(profile).toBeDefined();
      expect(profile.expressions.neutral).toBeDefined();
      expect(profile.expressions.angry).toBeDefined();
      expect(profile.expressions.hurt).toBeDefined();
      expect(profile.expressions.dead).toBeDefined();
    }
  });

  it('all archetypes have overlay configs', () => {
    for (const id of archetypeIds) {
      expect(OVERLAY_CONFIGS[id]).toBeDefined();
      expect(OVERLAY_CONFIGS[id].breathing).toBeDefined();
    }
  });

  it('skeleton bone parents exist before children', () => {
    for (const id of archetypeIds) {
      const defs = SKELETON_DEFS[id];
      const seen = new Set();
      for (const bone of defs) {
        if (bone.parent !== null) {
          expect(seen.has(bone.parent)).toBe(true);
        }
        seen.add(bone.name);
      }
    }
  });

  it('slot bone references exist in skeleton', () => {
    for (const id of archetypeIds) {
      const skel = createSkeleton(id, SKELETON_DEFS[id]);
      for (const slot of SLOT_DEFS[id]) {
        expect(skel.getBoneIndex(slot.bone)).not.toBe(-1);
      }
    }
  });

  it('clip track bone references exist in skeleton', () => {
    for (const id of archetypeIds) {
      const skel = createSkeleton(id, SKELETON_DEFS[id]);
      const clips = CLIP_DEFS[id];
      for (const [clipName, clip] of Object.entries(clips)) {
        for (const track of clip.tracks) {
          expect(skel.getBoneIndex(track.bone)).not.toBe(-1);
        }
      }
    }
  });

  it('archetypes have rig reference fields', () => {
    for (const id of archetypeIds) {
      const arch = ARCHETYPES[id];
      expect(arch.skeletonId).toBe(id);
      expect(arch.secondaryId).toBe(id);
      expect(arch.expressionId).toBe(id);
    }
  });
});

// ══════════════════════════════════════════════════════════
//  Integrated resolver (skeleton path)
// ══════════════════════════════════════════════════════════

describe('Skeleton-based resolver', () => {
  let resolver;

  beforeEach(() => {
    resolver = createCreatureResolver();
  });

  it('resolves enemy entities with useSkeleton=true', () => {
    const e = makeEntity({ type: TYPE.ENEMY_BASIC });
    const model = resolver.resolve(e, 1.0, 1 / 60);
    expect(model).not.toBeNull();
    expect(model.useSkeleton).toBe(true);
    expect(model.skeleton).toBeDefined();
    expect(model.worldPose).toBeDefined();
    expect(model.resolvedSlots).toBeDefined();
  });

  it('produces world pose with entity position', () => {
    const e = makeEntity({ x: 50, y: 75, type: TYPE.ENEMY_BASIC });
    const model = resolver.resolve(e, 1.0, 1 / 60);
    // Root bone world position should be near entity position
    expect(model.worldPose[PX]).toBeCloseTo(50, 0);
    expect(model.worldPose[PY]).toBeCloseTo(75, 0);
  });

  it('resolves slots with attachments', () => {
    const e = makeEntity({ type: TYPE.ENEMY_BASIC });
    const model = resolver.resolve(e, 1.0, 1 / 60);
    expect(model.resolvedSlots.length).toBeGreaterThan(0);
    // Should have at least body shape and eyes
    const hasShape = model.resolvedSlots.some(s => s.attachments.some(a => a.type === 'shape'));
    const hasEye = model.resolvedSlots.some(s => s.attachments.some(a => a.type === 'eye'));
    expect(hasShape).toBe(true);
    expect(hasEye).toBe(true);
  });

  it('expression params are populated', () => {
    const e = makeEntity({ type: TYPE.ENEMY_BASIC });
    const model = resolver.resolve(e, 1.0, 1 / 60);
    expect(model.expressionParams).toBeDefined();
    expect(model.expressionParams.eyeParams).toBeDefined();
  });

  it('animState reflects entity movement', () => {
    const moving = makeEntity({ type: TYPE.ENEMY_FAST, vx: 50, vy: 0 });
    const model = resolver.resolve(moving, 1.0, 1 / 60);
    expect(model.animState).toBe('locomotion');
  });

  it('deform is still populated for body shape drawing', () => {
    const e = makeEntity({ type: TYPE.ENEMY_BASIC });
    const model = resolver.resolve(e, 1.0, 1 / 60);
    expect(model.deform).toBeDefined();
    expect(model.deform.wobbleAt).toBeTypeOf('function');
    expect(model.deform.scaleX).toBeTypeOf('number');
  });

  it('all four enemy types resolve via skeleton path', () => {
    const types = [TYPE.ENEMY_BASIC, TYPE.ENEMY_FAST, TYPE.ENEMY_TANK, TYPE.ENEMY_RANGED];
    for (const type of types) {
      const e = makeEntity({ type, id: type * 10 });
      const model = resolver.resolve(e, 1.0, 1 / 60);
      expect(model.useSkeleton).toBe(true);
      expect(model.skeleton.boneCount).toBeGreaterThan(5);
    }
  });

  it('rig instances are cached per entity', () => {
    const e = makeEntity({ id: 42, type: TYPE.ENEMY_BASIC });
    const m1 = resolver.resolve(e, 1.0, 1 / 60);
    const m2 = resolver.resolve(e, 2.0, 1 / 60);
    // Same skeleton reference = same rig
    expect(m1.skeleton).toBe(m2.skeleton);
  });

  it('reset clears rig cache', () => {
    const e = makeEntity({ id: 42, type: TYPE.ENEMY_BASIC });
    resolver.resolve(e, 1.0, 1 / 60);
    resolver.reset();
    // After reset, should still resolve fine (re-creates rig)
    const model = resolver.resolve(e, 1.0, 1 / 60);
    expect(model.useSkeleton).toBe(true);
  });
});
