/**
 * Tests for the skeletal animation subsystem.
 *
 * Covers: skeleton creation, bone world transforms, rotation interpolation,
 * 2-pose blending, masked blending, 2-bone IK, mesh skinning,
 * deterministic clip sampling, rig controller state machine.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { bone, slot, createSkeleton, meshAttachment } from '../src/animation/skeleton.js';
import { createPose, resetToBindPose, copyPose, computeWorldPose, applyDelta, getBoneLocal, setBoneLocal, STRIDE, TX, TY, ROT, SX, SY } from '../src/animation/pose.js';
import { clip, track, kf } from '../src/animation/clip.js';
import { sampleClip, sampleChannel, getClipProgress, isClipFinished } from '../src/animation/sampler.js';
import { blendPoses, applyAdditive, maskedBlend, maskedAdditive } from '../src/animation/blend.js';
import { aimConstraint, trailConstraint, createTrailState } from '../src/animation/constraints.js';
import { solve2BoneIK } from '../src/animation/ik.js';
import { createSkinnedMesh, createQuadMesh } from '../src/animation/mesh.js';
import { skinMesh } from '../src/animation/skinning.js';
import { createRigController } from '../src/animation/rig-controller.js';

// ── Helpers ──

function makeBones() {
  return [
    bone('root', -1, 0, { x: 0, y: 0 }),
    bone('torso', 0, 5, { x: 0, y: -3 }),
    bone('head', 1, 3, { x: 0, y: -4 }),
    bone('left_arm', 1, 4, { x: -2, y: -2 }),
    bone('right_arm', 1, 4, { x: 2, y: -2 }),
  ];
}

function makeSimpleSkeleton() {
  return createSkeleton(makeBones());
}

function makeEntity(overrides = {}) {
  return {
    id: 1, x: 100, y: 200, vx: 0, vy: 0,
    hp: 30, maxHp: 30, type: 3, state: 1,
    radius: 10, damage: 8, speed: 60, facing: 0,
    ...overrides,
  };
}

// ── Skeleton ──

describe('Skeleton', () => {
  it('creates a skeleton with correct bone count and lookup', () => {
    const skel = makeSimpleSkeleton();
    expect(skel.boneCount).toBe(5);
    expect(skel.getBoneIndex('root')).toBe(0);
    expect(skel.getBoneIndex('head')).toBe(2);
    expect(skel.getBoneIndex('nonexistent')).toBe(-1);
  });

  it('rejects invalid parent ordering', () => {
    expect(() => createSkeleton([
      bone('child', 1, 0),  // parent index 1 but only bone 0 exists
      bone('root', -1, 0),
    ])).toThrow();
  });

  it('sorts slots by draw order', () => {
    const s = createSkeleton(
      [bone('root', -1, 0)],
      [slot('top', 0, 'a', 10), slot('bottom', 0, 'b', 1)],
    );
    expect(s.slots[0].name).toBe('bottom');
    expect(s.slots[1].name).toBe('top');
  });
});

// ── Pose ──

describe('Pose', () => {
  it('resets to bind pose correctly', () => {
    const skel = makeSimpleSkeleton();
    const pose = createPose(skel.boneCount);
    resetToBindPose(skel, pose);

    // Root should be at origin
    expect(pose[0 * STRIDE + TX]).toBe(0);
    expect(pose[0 * STRIDE + TY]).toBe(0);

    // Torso at (0, -3) relative to root
    expect(pose[1 * STRIDE + TX]).toBe(0);
    expect(pose[1 * STRIDE + TY]).toBe(-3);

    // All scales should be 1
    for (let i = 0; i < skel.boneCount; i++) {
      expect(pose[i * STRIDE + SX]).toBe(1);
      expect(pose[i * STRIDE + SY]).toBe(1);
    }
  });

  it('copies pose correctly', () => {
    const skel = makeSimpleSkeleton();
    const a = createPose(skel.boneCount);
    const b = createPose(skel.boneCount);
    resetToBindPose(skel, a);
    a[0] = 42;
    copyPose(b, a);
    expect(b[0]).toBe(42);
  });

  it('computes world transforms for root bone', () => {
    const skel = makeSimpleSkeleton();
    const local = createPose(skel.boneCount);
    const world = createPose(skel.boneCount);
    resetToBindPose(skel, local);

    computeWorldPose(skel, local, world, 100, 200, 0, 1);
    // Root at world origin + root position
    expect(world[0 * STRIDE + TX]).toBe(100);
    expect(world[0 * STRIDE + TY]).toBe(200);
  });

  it('computes child world transforms correctly', () => {
    const skel = makeSimpleSkeleton();
    const local = createPose(skel.boneCount);
    const world = createPose(skel.boneCount);
    resetToBindPose(skel, local);

    computeWorldPose(skel, local, world, 0, 0, 0, 1);
    // Torso is at (0, -3) local, parent is root at (0,0)
    expect(world[1 * STRIDE + TX]).toBeCloseTo(0, 5);
    expect(world[1 * STRIDE + TY]).toBeCloseTo(-3, 5);

    // Head is at (0, -4) relative to torso at (0, -3)
    expect(world[2 * STRIDE + TX]).toBeCloseTo(0, 5);
    expect(world[2 * STRIDE + TY]).toBeCloseTo(-7, 5);
  });

  it('applies root rotation to children', () => {
    const skel = makeSimpleSkeleton();
    const local = createPose(skel.boneCount);
    const world = createPose(skel.boneCount);
    resetToBindPose(skel, local);

    // Rotate root by 90 degrees (PI/2)
    computeWorldPose(skel, local, world, 0, 0, Math.PI / 2, 1);

    // Torso was at (0, -3). Rotated 90deg: (-3*sin(90), -3*cos(90)) wait...
    // Actually: rotated (0, -3) by PI/2:
    //   x' = 0*cos(90) - (-3)*sin(90) = 3
    //   y' = 0*sin(90) + (-3)*cos(90) = 0
    expect(world[1 * STRIDE + TX]).toBeCloseTo(3, 4);
    expect(world[1 * STRIDE + TY]).toBeCloseTo(0, 4);
  });

  it('applies root scale', () => {
    const skel = makeSimpleSkeleton();
    const local = createPose(skel.boneCount);
    const world = createPose(skel.boneCount);
    resetToBindPose(skel, local);

    computeWorldPose(skel, local, world, 0, 0, 0, 2);
    // Torso at (0, -3) * scale 2 = (0, -6)
    expect(world[1 * STRIDE + TY]).toBeCloseTo(-6, 5);
    // Scale propagates
    expect(world[1 * STRIDE + SX]).toBeCloseTo(2, 5);
  });
});

// ── Clip Sampling ──

describe('Clip Sampling', () => {
  const testClip = clip('test', 1.0, [
    track('torso', {
      tx: [kf(0, 0), kf(0.5, 10), kf(1, 0)],
      rot: [kf(0, 0), kf(1, Math.PI)],
    }),
  ]);

  it('samples at start', () => {
    const skel = makeSimpleSkeleton();
    const pose = createPose(skel.boneCount);
    resetToBindPose(skel, pose);
    sampleClip(testClip, 0, skel, pose);
    expect(pose[1 * STRIDE + TX]).toBeCloseTo(0, 5);
  });

  it('samples mid-clip with interpolation', () => {
    const skel = makeSimpleSkeleton();
    const pose = createPose(skel.boneCount);
    resetToBindPose(skel, pose);
    sampleClip(testClip, 0.25, skel, pose);
    expect(pose[1 * STRIDE + TX]).toBeCloseTo(5, 5);
  });

  it('samples at end', () => {
    const skel = makeSimpleSkeleton();
    const pose = createPose(skel.boneCount);
    resetToBindPose(skel, pose);
    sampleClip(testClip, 1, skel, pose);
    expect(pose[1 * STRIDE + TX]).toBeCloseTo(0, 5);
  });

  it('loops correctly', () => {
    const skel = makeSimpleSkeleton();
    const pose = createPose(skel.boneCount);
    resetToBindPose(skel, pose);
    // At time 1.25, looped = 0.25
    sampleClip(testClip, 1.25, skel, pose);
    expect(pose[1 * STRIDE + TX]).toBeCloseTo(5, 5);
  });

  it('clamps non-looping clips', () => {
    const clampClip = clip('clamp', 1.0, [
      track('torso', { tx: [kf(0, 0), kf(1, 10)] }),
    ], { loop: false });

    const skel = makeSimpleSkeleton();
    const pose = createPose(skel.boneCount);
    resetToBindPose(skel, pose);
    sampleClip(clampClip, 2.0, skel, pose);
    expect(pose[1 * STRIDE + TX]).toBeCloseTo(10, 5);
  });

  it('interpolates rotation across wraparound', () => {
    // Test that rotation takes shortest path
    const result = sampleChannel(
      [kf(0, Math.PI * 0.9), kf(1, -Math.PI * 0.9)],
      0.5,
      true,
    );
    // Shortest path from 0.9*PI to -0.9*PI goes through PI, not through 0
    expect(Math.abs(result)).toBeGreaterThan(Math.PI * 0.8);
  });

  it('reports clip progress', () => {
    expect(getClipProgress(testClip, 0.5)).toBeCloseTo(0.5, 5);
    expect(getClipProgress(testClip, 1.5)).toBeCloseTo(0.5, 5); // looped
  });

  it('detects finished non-looping clip', () => {
    const oneShot = clip('os', 0.5, [], { loop: false });
    expect(isClipFinished(oneShot, 0.3)).toBe(false);
    expect(isClipFinished(oneShot, 0.5)).toBe(true);
    expect(isClipFinished(oneShot, 1.0)).toBe(true);
  });

  it('produces deterministic results at fixed timestamps', () => {
    const skel = makeSimpleSkeleton();
    const pose1 = createPose(skel.boneCount);
    const pose2 = createPose(skel.boneCount);
    resetToBindPose(skel, pose1);
    resetToBindPose(skel, pose2);

    sampleClip(testClip, 0.333, skel, pose1);
    sampleClip(testClip, 0.333, skel, pose2);

    for (let i = 0; i < pose1.length; i++) {
      expect(pose1[i]).toBe(pose2[i]);
    }
  });
});

// ── Blending ──

describe('Pose Blending', () => {
  it('blends two poses by weight', () => {
    const bc = 2;
    const a = createPose(bc);
    const b = createPose(bc);
    const out = createPose(bc);

    // Pose A: bone 0 at (0, 0), bone 1 at (10, 0)
    a[0 * STRIDE + TX] = 0;
    a[1 * STRIDE + TX] = 10;
    a[0 * STRIDE + SX] = 1; a[0 * STRIDE + SY] = 1;
    a[1 * STRIDE + SX] = 1; a[1 * STRIDE + SY] = 1;

    // Pose B: bone 0 at (20, 0), bone 1 at (30, 0)
    b[0 * STRIDE + TX] = 20;
    b[1 * STRIDE + TX] = 30;
    b[0 * STRIDE + SX] = 1; b[0 * STRIDE + SY] = 1;
    b[1 * STRIDE + SX] = 1; b[1 * STRIDE + SY] = 1;

    blendPoses(a, b, 0.5, out, bc);
    expect(out[0 * STRIDE + TX]).toBeCloseTo(10, 5);
    expect(out[1 * STRIDE + TX]).toBeCloseTo(20, 5);
  });

  it('weight=0 returns pose A', () => {
    const bc = 1;
    const a = createPose(bc);
    const b = createPose(bc);
    const out = createPose(bc);
    a[TX] = 5; a[SX] = 1; a[SY] = 1;
    b[TX] = 15; b[SX] = 1; b[SY] = 1;

    blendPoses(a, b, 0, out, bc);
    expect(out[TX]).toBeCloseTo(5, 5);
  });

  it('weight=1 returns pose B', () => {
    const bc = 1;
    const a = createPose(bc);
    const b = createPose(bc);
    const out = createPose(bc);
    a[TX] = 5; a[SX] = 1; a[SY] = 1;
    b[TX] = 15; b[SX] = 1; b[SY] = 1;

    blendPoses(a, b, 1, out, bc);
    expect(out[TX]).toBeCloseTo(15, 5);
  });

  it('applies additive pose', () => {
    const bc = 1;
    const base = createPose(bc);
    const add = createPose(bc);

    base[TX] = 10; base[TY] = 5; base[ROT] = 0; base[SX] = 1; base[SY] = 1;
    add[TX] = 3; add[TY] = 2; add[ROT] = 0.5; add[SX] = 1.1; add[SY] = 0.9;

    applyAdditive(base, add, 1, bc);
    expect(base[TX]).toBeCloseTo(13, 5);
    expect(base[TY]).toBeCloseTo(7, 5);
    expect(base[ROT]).toBeCloseTo(0.5, 5);
    expect(base[SX]).toBeCloseTo(1.1, 5);
    expect(base[SY]).toBeCloseTo(0.9, 5);
  });

  it('masked blend only affects masked bones', () => {
    const bc = 3;
    const a = createPose(bc);
    const b = createPose(bc);
    const out = createPose(bc);

    for (let i = 0; i < bc; i++) {
      a[i * STRIDE + TX] = 0; a[i * STRIDE + SX] = 1; a[i * STRIDE + SY] = 1;
      b[i * STRIDE + TX] = 10; b[i * STRIDE + SX] = 1; b[i * STRIDE + SY] = 1;
    }

    const mask = new Set([1]); // Only bone 1
    maskedBlend(a, b, 0.5, out, bc, mask);

    expect(out[0 * STRIDE + TX]).toBeCloseTo(0, 5); // Not masked
    expect(out[1 * STRIDE + TX]).toBeCloseTo(5, 5); // Masked — blended
    expect(out[2 * STRIDE + TX]).toBeCloseTo(0, 5); // Not masked
  });
});

// ── 2-Bone IK ──

describe('2-Bone IK', () => {
  it('reaches a reachable target', () => {
    // Simple setup: root at (0,0), upper arm right, lower arm right
    const bones = [
      bone('root', -1, 0),
      bone('upper', 0, 5, { x: 0, y: 0 }),
      bone('lower', 1, 5, { x: 5, y: 0 }),
    ];
    const skel = createSkeleton(bones);
    const local = createPose(3);
    const world = createPose(3);
    resetToBindPose(skel, local);
    computeWorldPose(skel, local, world, 0, 0, 0, 1);

    // Target at (8, 0) — reachable with total length 10
    solve2BoneIK(world, 1, 2, 5, 5, 8, 0, 1, 1);

    // The tip of the lower bone should be near the target
    const lowerRot = world[2 * STRIDE + ROT];
    const lowerX = world[2 * STRIDE + TX];
    const lowerY = world[2 * STRIDE + TY];
    const tipX = lowerX + Math.cos(lowerRot) * 5;
    const tipY = lowerY + Math.sin(lowerRot) * 5;

    expect(tipX).toBeCloseTo(8, 0);
    expect(tipY).toBeCloseTo(0, 0);
  });

  it('extends fully for out-of-reach target', () => {
    const bones = [
      bone('root', -1, 0),
      bone('upper', 0, 5, { x: 0, y: 0 }),
      bone('lower', 1, 5, { x: 5, y: 0 }),
    ];
    const skel = createSkeleton(bones);
    const local = createPose(3);
    const world = createPose(3);
    resetToBindPose(skel, local);
    computeWorldPose(skel, local, world, 0, 0, 0, 1);

    // Target at (20, 0) — beyond reach of 10
    solve2BoneIK(world, 1, 2, 5, 5, 20, 0, 1, 1);

    // Both bones should point toward target (fully extended)
    const upperRot = world[1 * STRIDE + ROT];
    expect(upperRot).toBeCloseTo(0, 1); // pointing right
  });
});

// ── Skinning ──

describe('Mesh Skinning', () => {
  it('skins a vertex weighted to one bone', () => {
    const skel = createSkeleton([bone('root', -1, 0), bone('arm', 0, 5, { x: 5, y: 0 })]);
    const local = createPose(2);
    const world = createPose(2);
    resetToBindPose(skel, local);
    computeWorldPose(skel, local, world, 10, 20, 0, 1);

    const mesh = createQuadMesh(1, 4, 4); // weighted to bone 1 (arm)
    skinMesh(mesh, world, skel);

    // Bone 1 world position is at (10+5, 20) = (15, 20)
    // Quad vertices are centered on the bone's world position
    // Vertex 0: (-2, -2) local → (15-2, 20-2) = (13, 18)
    expect(mesh.deformedVertices[0]).toBeCloseTo(13, 4);
    expect(mesh.deformedVertices[1]).toBeCloseTo(18, 4);
  });

  it('skins a vertex weighted to two bones', () => {
    const skel = createSkeleton([
      bone('root', -1, 0),
      bone('a', 0, 0, { x: 0, y: 0 }),
      bone('b', 0, 0, { x: 10, y: 0 }),
    ]);
    const local = createPose(3);
    const world = createPose(3);
    resetToBindPose(skel, local);
    computeWorldPose(skel, local, world, 0, 0, 0, 1);

    // Vertex at (0, 0), weighted 50/50 to bone 1 (at 0,0) and bone 2 (at 10,0)
    const mesh = createSkinnedMesh({
      vertices: [0, 0],
      indices: [0, 0, 0], // degenerate but valid for skinning test
      boneIndices: [1, 2, 0, 0],
      boneWeights: [0.5, 0.5, 0, 0],
    });
    skinMesh(mesh, world, skel);

    // Result should be average of bone 1 (0,0) and bone 2 (10,0) → (5, 0)
    expect(mesh.deformedVertices[0]).toBeCloseTo(5, 4);
    expect(mesh.deformedVertices[1]).toBeCloseTo(0, 4);
  });

  it('skinning with rotation transforms vertices', () => {
    const skel = createSkeleton([bone('root', -1, 0)]);
    const local = createPose(1);
    const world = createPose(1);
    resetToBindPose(skel, local);
    // Root rotated 90 degrees
    computeWorldPose(skel, local, world, 0, 0, Math.PI / 2, 1);

    const mesh = createSkinnedMesh({
      vertices: [5, 0],
      indices: [0, 0, 0],
      boneIndices: [0, 0, 0, 0],
      boneWeights: [1, 0, 0, 0],
    });
    skinMesh(mesh, world, skel);

    // (5, 0) rotated 90deg → (0, 5)
    expect(mesh.deformedVertices[0]).toBeCloseTo(0, 4);
    expect(mesh.deformedVertices[1]).toBeCloseTo(5, 4);
  });
});

// ── Constraints ──

describe('Constraints', () => {
  it('aim constraint rotates bone toward target', () => {
    const skel = createSkeleton([bone('root', -1, 0), bone('head', 0, 3, { x: 0, y: -3 })]);
    const local = createPose(2);
    const world = createPose(2);
    resetToBindPose(skel, local);
    computeWorldPose(skel, local, world, 0, 0, 0, 1);

    // Head at (0, -3). Target at (10, -3) → should aim right (angle = 0)
    aimConstraint(world, 1, 10, -3, 1);
    expect(world[1 * STRIDE + ROT]).toBeCloseTo(0, 3);
  });

  it('trail constraint smooths positions', () => {
    const bones = [
      bone('root', -1, 0),
      bone('chain0', 0, 3, { x: 0, y: 3 }),
      bone('chain1', 1, 3, { x: 0, y: 3 }),
    ];
    const skel = createSkeleton(bones);
    const local = createPose(3);
    const world = createPose(3);
    resetToBindPose(skel, local);
    computeWorldPose(skel, local, world, 0, 0, 0, 1);

    const trailState = createTrailState(2);
    const chainIndices = [1, 2];

    // First frame — initializes
    trailConstraint(world, chainIndices, trailState, 0.3, 1 / 60);

    // Move root to (10, 0) and recompute
    computeWorldPose(skel, local, world, 10, 0, 0, 1);
    trailConstraint(world, chainIndices, trailState, 0.3, 1 / 60);

    // Chain bones should lag behind the new position
    expect(world[1 * STRIDE + TX]).toBeLessThan(10);
  });
});

// ── Rig Controller ──

describe('Rig Controller', () => {
  const testClips = {
    idle: clip('idle', 2, [track('torso', { rot: [kf(0, 0), kf(2, 0)] })]),
    drift: clip('drift', 1.5, [track('torso', { rot: [kf(0, 0.05), kf(1.5, 0.05)] })]),
    chase: clip('chase', 0.8, [track('torso', { rot: [kf(0, 0.1), kf(0.8, 0.1)] })]),
    spawn: clip('spawn', 0.5, [], { loop: false }),
    hit_react: clip('hit_react', 0.3, [], { loop: false }),
    death: clip('death', 0.6, [], { loop: false }),
  };

  it('starts in spawn state', () => {
    const ctrl = createRigController(testClips);
    expect(ctrl.state).toBe('spawn');
  });

  it('transitions to idle after spawn completes', () => {
    const ctrl = createRigController(testClips);
    const entity = makeEntity();
    // Advance past spawn duration
    for (let i = 0; i < 40; i++) {
      ctrl.update(entity, 1 / 60, i / 60);
    }
    expect(ctrl.state).toBe('idle');
  });

  it('transitions to chase when moving fast', () => {
    const ctrl = createRigController(testClips);
    const entity = makeEntity({ vx: 80, vy: 0 });
    // Skip spawn
    for (let i = 0; i < 60; i++) {
      ctrl.update(entity, 1 / 60, i / 60);
    }
    expect(ctrl.state).toBe('chase');
  });

  it('transitions to death when dying', () => {
    const ctrl = createRigController(testClips);
    const entity = makeEntity({ state: 2 });
    // Skip spawn
    for (let i = 0; i < 40; i++) {
      ctrl.update(entity, 1 / 60, i / 60);
    }
    expect(ctrl.state).toBe('death');
  });

  it('detects hit when HP drops', () => {
    const ctrl = createRigController(testClips);
    const entity = makeEntity();
    // Initialize prevHp
    ctrl.update(entity, 1 / 60, 0);
    // Skip spawn
    for (let i = 0; i < 40; i++) {
      ctrl.update(entity, 1 / 60, i / 60);
    }
    // Now reduce HP
    entity.hp = 20;
    const params = ctrl.update(entity, 1 / 60, 1);
    expect(params.recoilIntensity).toBeGreaterThan(0);
  });

  it('produces hover offset', () => {
    const ctrl = createRigController(testClips);
    const entity = makeEntity();
    const params = ctrl.update(entity, 1 / 60, 1.0);
    expect(typeof params.hoverOffset).toBe('number');
  });
});

// ── Ghost Witch Rig ──

describe('Ghost Witch Rig', () => {
  it('loads rig and clips without errors', async () => {
    const { GHOST_WITCH_SKELETON, GHOST_WITCH_MESHES } = await import('../src/content/rigs/ghost-witch-rig.js');
    const { GHOST_WITCH_CLIPS } = await import('../src/content/animations/ghost-witch-clips.js');

    expect(GHOST_WITCH_SKELETON.boneCount).toBe(15);
    expect(GHOST_WITCH_MESHES.length).toBe(7);
    expect(Object.keys(GHOST_WITCH_CLIPS)).toContain('idle');
    expect(Object.keys(GHOST_WITCH_CLIPS)).toContain('death');
  });

  it('all clip bone references are valid', async () => {
    const { GHOST_WITCH_SKELETON } = await import('../src/content/rigs/ghost-witch-rig.js');
    const { GHOST_WITCH_CLIPS } = await import('../src/content/animations/ghost-witch-clips.js');

    for (const [name, cl] of Object.entries(GHOST_WITCH_CLIPS)) {
      for (const tr of cl.tracks) {
        const idx = GHOST_WITCH_SKELETON.getBoneIndex(tr.boneName);
        expect(idx, `Clip "${name}" references unknown bone "${tr.boneName}"`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('skinning produces non-zero vertices', async () => {
    const { GHOST_WITCH_SKELETON, GHOST_WITCH_MESHES } = await import('../src/content/rigs/ghost-witch-rig.js');
    const { GHOST_WITCH_CLIPS } = await import('../src/content/animations/ghost-witch-clips.js');

    const skel = GHOST_WITCH_SKELETON;
    const local = createPose(skel.boneCount);
    const world = createPose(skel.boneCount);
    resetToBindPose(skel, local);
    sampleClip(GHOST_WITCH_CLIPS.idle, 0, skel, local);
    computeWorldPose(skel, local, world, 100, 200, 0, 1);

    const mesh = { ...GHOST_WITCH_MESHES[0], deformedVertices: new Float32Array(GHOST_WITCH_MESHES[0].bindVertices.length) };
    skinMesh(mesh, world, skel);

    // At least some vertices should be non-zero
    let hasNonZero = false;
    for (let i = 0; i < mesh.deformedVertices.length; i++) {
      if (mesh.deformedVertices[i] !== 0) { hasNonZero = true; break; }
    }
    expect(hasNonZero).toBe(true);
  });
});
