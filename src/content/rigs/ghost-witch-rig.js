/**
 * Ghost Witch rig definition.
 *
 * A spectral witch with articulated upper body, trailing robe/cloth,
 * and distinct arms. Matches the dark, glowing silhouette style of the game.
 *
 * Bone hierarchy:
 *   root
 *   ├── torso
 *   │   ├── head
 *   │   │   └── hair
 *   │   ├── left_upper_arm
 *   │   │   └── left_lower_arm
 *   │   │       └── left_hand
 *   │   ├── right_upper_arm
 *   │   │   └── right_lower_arm
 *   │   │       └── right_hand
 *   │   └── robe_upper
 *   │       └── robe_mid
 *   │           └── robe_lower
 *   │               └── robe_tip
 *   │                   └── robe_trail
 *
 * All positions in bind space are relative to parent.
 * Units are approximately pixels at radius=10 scale.
 */

import { bone, slot, createSkeleton, meshAttachment } from '../../animation/skeleton.js';
import { createWeightedMesh, createQuadMesh } from '../../animation/mesh.js';

// ── Bone definitions (topological order) ──

const BONES = [
  // 0: root — center of entity, floating anchor
  bone('root', -1, 0, { x: 0, y: 0 }, 0),
  // 1: torso — main body mass, offset upward
  bone('torso', 0, 6, { x: 0, y: -2 }, 0),
  // 2: head — top of torso
  bone('head', 1, 4, { x: 0, y: -5 }, 0),
  // 3: hair — trails behind head
  bone('hair', 2, 3, { x: 0, y: -2.5 }, 0),
  // 4: left upper arm
  bone('left_upper_arm', 1, 3.5, { x: -3, y: -3 }, -0.3),
  // 5: left lower arm
  bone('left_lower_arm', 4, 3, { x: 0, y: -3.5 }, 0),
  // 6: left hand
  bone('left_hand', 5, 1.5, { x: 0, y: -3 }, 0),
  // 7: right upper arm
  bone('right_upper_arm', 1, 3.5, { x: 3, y: -3 }, 0.3),
  // 8: right lower arm
  bone('right_lower_arm', 7, 3, { x: 0, y: -3.5 }, 0),
  // 9: right hand
  bone('right_hand', 8, 1.5, { x: 0, y: -3 }, 0),
  // 10: robe upper — starts at torso bottom
  bone('robe_upper', 1, 3, { x: 0, y: 3 }, 0),
  // 11: robe mid
  bone('robe_mid', 10, 3, { x: 0, y: 3 }, 0),
  // 12: robe lower
  bone('robe_lower', 11, 3, { x: 0, y: 3 }, 0),
  // 13: robe tip
  bone('robe_tip', 12, 2.5, { x: 0, y: 2.5 }, 0),
  // 14: robe trail
  bone('robe_trail', 13, 2, { x: 0, y: 2 }, 0),
];

// ── Mesh definitions ──

// Head — an elongated oval
const HEAD_MESH = createWeightedMesh([
  { x: -2.5, y: -3.5, bones: [[2, 1]] },
  { x: 0, y: -4.5, bones: [[2, 1]] },
  { x: 2.5, y: -3.5, bones: [[2, 1]] },
  { x: 3, y: -1, bones: [[2, 0.8], [1, 0.2]] },
  { x: 2, y: 1, bones: [[2, 0.6], [1, 0.4]] },
  { x: -2, y: 1, bones: [[2, 0.6], [1, 0.4]] },
  { x: -3, y: -1, bones: [[2, 0.8], [1, 0.2]] },
], [
  0, 1, 6,
  1, 2, 3,
  1, 3, 6,
  6, 3, 5,
  3, 4, 5,
], '#2a1a3a', { strokeColor: 'rgba(120, 80, 180, 0.4)', strokeWidth: 0.5 });

// Torso — broad upper body
const TORSO_MESH = createWeightedMesh([
  { x: -3.5, y: -3, bones: [[1, 1]] },
  { x: 3.5, y: -3, bones: [[1, 1]] },
  { x: 4, y: 0, bones: [[1, 0.9], [10, 0.1]] },
  { x: 3, y: 3, bones: [[1, 0.5], [10, 0.5]] },
  { x: -3, y: 3, bones: [[1, 0.5], [10, 0.5]] },
  { x: -4, y: 0, bones: [[1, 0.9], [10, 0.1]] },
  { x: 0, y: -4, bones: [[1, 1]] },  // top center
], [
  0, 6, 5,
  6, 1, 2,
  6, 2, 5,
  5, 2, 4,
  2, 3, 4,
], '#1a0e2a', { strokeColor: 'rgba(100, 60, 160, 0.3)', strokeWidth: 0.5 });

// Left arm (upper + lower + hand as single mesh weighted across bones)
const LEFT_ARM_MESH = createWeightedMesh([
  // Upper arm top
  { x: -1.2, y: 0.5, bones: [[4, 1]] },
  { x: 1.2, y: 0.5, bones: [[4, 1]] },
  // Upper-lower joint
  { x: -1, y: -3.5, bones: [[4, 0.4], [5, 0.6]] },
  { x: 1, y: -3.5, bones: [[4, 0.4], [5, 0.6]] },
  // Lower arm mid
  { x: -0.8, y: -6, bones: [[5, 0.8], [6, 0.2]] },
  { x: 0.8, y: -6, bones: [[5, 0.8], [6, 0.2]] },
  // Hand/claw tip
  { x: -1.2, y: -8, bones: [[6, 1]] },
  { x: 0, y: -9, bones: [[6, 1]] },
  { x: 1.2, y: -8, bones: [[6, 1]] },
], [
  0, 1, 3, 0, 3, 2,
  2, 3, 5, 2, 5, 4,
  4, 5, 8, 4, 8, 7, 4, 7, 6,
], '#1a0e2a', { opacity: 0.9 });

// Right arm — mirror
const RIGHT_ARM_MESH = createWeightedMesh([
  { x: -1.2, y: 0.5, bones: [[7, 1]] },
  { x: 1.2, y: 0.5, bones: [[7, 1]] },
  { x: -1, y: -3.5, bones: [[7, 0.4], [8, 0.6]] },
  { x: 1, y: -3.5, bones: [[7, 0.4], [8, 0.6]] },
  { x: -0.8, y: -6, bones: [[8, 0.8], [9, 0.2]] },
  { x: 0.8, y: -6, bones: [[8, 0.8], [9, 0.2]] },
  { x: -1.2, y: -8, bones: [[9, 1]] },
  { x: 0, y: -9, bones: [[9, 1]] },
  { x: 1.2, y: -8, bones: [[9, 1]] },
], [
  0, 1, 3, 0, 3, 2,
  2, 3, 5, 2, 5, 4,
  4, 5, 8, 4, 8, 7, 4, 7, 6,
], '#1a0e2a', { opacity: 0.9 });

// Robe — flowing lower body, heavily weighted across robe chain
const ROBE_MESH = createWeightedMesh([
  // Top edge (attached to torso bottom)
  { x: -4, y: 0, bones: [[10, 0.7], [1, 0.3]] },
  { x: 4, y: 0, bones: [[10, 0.7], [1, 0.3]] },
  // Upper-mid
  { x: -5, y: 3, bones: [[10, 0.5], [11, 0.5]] },
  { x: 5, y: 3, bones: [[10, 0.5], [11, 0.5]] },
  // Mid
  { x: -5.5, y: 6, bones: [[11, 0.5], [12, 0.5]] },
  { x: 5.5, y: 6, bones: [[11, 0.5], [12, 0.5]] },
  // Lower
  { x: -5, y: 9, bones: [[12, 0.5], [13, 0.5]] },
  { x: 5, y: 9, bones: [[12, 0.5], [13, 0.5]] },
  // Tip
  { x: -4, y: 11.5, bones: [[13, 0.5], [14, 0.5]] },
  { x: 4, y: 11.5, bones: [[13, 0.5], [14, 0.5]] },
  // Trail
  { x: -2.5, y: 13.5, bones: [[14, 1]] },
  { x: 0, y: 14.5, bones: [[14, 1]] },
  { x: 2.5, y: 13.5, bones: [[14, 1]] },
], [
  0, 1, 3, 0, 3, 2,
  2, 3, 5, 2, 5, 4,
  4, 5, 7, 4, 7, 6,
  6, 7, 9, 6, 9, 8,
  8, 9, 12, 8, 12, 11, 8, 11, 10,
], '#0e0818', { strokeColor: 'rgba(80, 40, 140, 0.3)', strokeWidth: 0.3, opacity: 0.95 });

// Hair — small trailing wisps behind head
const HAIR_MESH = createWeightedMesh([
  { x: -2, y: 0, bones: [[3, 0.7], [2, 0.3]] },
  { x: 2, y: 0, bones: [[3, 0.7], [2, 0.3]] },
  { x: -1.5, y: -2.5, bones: [[3, 1]] },
  { x: 0, y: -3, bones: [[3, 1]] },
  { x: 1.5, y: -2.5, bones: [[3, 1]] },
], [
  0, 1, 4, 0, 4, 3, 0, 3, 2,
], '#2a1a3a', { opacity: 0.8 });

// Eye glow — small accent mesh on head
const EYE_MESH = createWeightedMesh([
  { x: -1.2, y: -1.5, bones: [[2, 1]] },
  { x: -0.3, y: -2, bones: [[2, 1]] },
  { x: -0.3, y: -1, bones: [[2, 1]] },
  { x: 1.2, y: -1.5, bones: [[2, 1]] },
  { x: 0.3, y: -2, bones: [[2, 1]] },
  { x: 0.3, y: -1, bones: [[2, 1]] },
], [
  0, 1, 2,  // left eye
  3, 4, 5,  // right eye
], '#a060ff', { opacity: 0.9 });

// ── Slots (draw order) ──

const SLOTS = [
  slot('robe', 10, 'robe', 0),
  slot('left_arm', 4, 'left_arm', 1),
  slot('right_arm', 7, 'right_arm', 2),
  slot('torso', 1, 'torso', 3),
  slot('head', 2, 'head', 4),
  slot('hair', 3, 'hair', 5),
  slot('eyes', 2, 'eyes', 6),
];

// ── Attachments map ──

const ATTACHMENTS = {
  head: HEAD_MESH,
  torso: TORSO_MESH,
  left_arm: LEFT_ARM_MESH,
  right_arm: RIGHT_ARM_MESH,
  robe: ROBE_MESH,
  hair: HAIR_MESH,
  eyes: EYE_MESH,
};

// ── Assembled skeleton ──

export const GHOST_WITCH_SKELETON = createSkeleton(BONES, SLOTS, ATTACHMENTS);

/** All meshes in draw order */
export const GHOST_WITCH_MESHES = [
  ROBE_MESH,
  LEFT_ARM_MESH,
  RIGHT_ARM_MESH,
  TORSO_MESH,
  HEAD_MESH,
  HAIR_MESH,
  EYE_MESH,
];

/** Bone names for the robe trail chain (used by trail constraint) */
export const ROBE_CHAIN = ['robe_upper', 'robe_mid', 'robe_lower', 'robe_tip', 'robe_trail'];

/** Bone names for the hair chain */
export const HAIR_CHAIN = ['hair'];

/** Rig controller config */
export const GHOST_WITCH_CONFIG = {
  hoverAmp: 0.7,
  hoverFreq: 0.6,
  leanFactor: 0.008,
  maxLean: 0.3,
  headLagFactor: 0.006,
  maxHeadLag: 0.4,
  recoilDecay: 4,
  dragStiffness: 0.15,
  idleSpeedThreshold: 5,
  driftSpeedThreshold: 30,
  spawnDuration: 0.5,
  hitReactDuration: 0.3,
};

/** Constraint configuration */
export const GHOST_WITCH_CONSTRAINTS = {
  lookBone: 'head',
  trails: [
    { bones: ROBE_CHAIN, stiffness: 0.12 },
    { bones: HAIR_CHAIN, stiffness: 0.25 },
  ],
};
