/**
 * Rig data definitions for all creature archetypes.
 *
 * Defines skeletons, slots, animation clips, expression profiles,
 * and overlay configurations for each archetype family.
 *
 * This is the data layer — no runtime logic or drawing code.
 * Consumed by the creature model resolver to build runtime instances.
 *
 * Archetypes:
 *   ghost  — ethereal wraith with trailing wisps
 *   ember  — flickering flame spirit with dancing tips
 *   brute  — heavy tank with hulking mass
 *   slime  — bouncy blob with springy appendages
 */

import { createClip, createTrack, kf } from './animation.js';
import { attachment } from './slots.js';

// ── Skeleton definitions ──
// Bones: { name, parent, x, y, rotation, scaleX, scaleY, tags }
// Coordinates are relative to entity radius. The resolver scales by radius at draw time.

export const SKELETON_DEFS = {
  ghost: [
    { name: 'root', parent: null, x: 0, y: 0 },
    { name: 'body', parent: 'root', x: 0, y: 0, tags: 'body' },
    { name: 'chest', parent: 'body', x: 0, y: -0.2, tags: 'body' },
    { name: 'head', parent: 'chest', x: 0, y: -0.3, tags: 'face' },
    { name: 'face_anchor', parent: 'head', x: 0, y: 0, tags: 'face,anchor' },
    { name: 'left_arm', parent: 'chest', x: -0.55, y: 0.05, tags: 'limb' },
    { name: 'right_arm', parent: 'chest', x: 0.55, y: 0.05, tags: 'limb' },
    { name: 'crest_l', parent: 'head', x: -0.25, y: -0.35, tags: 'accent,deformable' },
    { name: 'crest_r', parent: 'head', x: 0.15, y: -0.4, tags: 'accent,deformable' },
    { name: 'tail', parent: 'body', x: 0, y: 0.55, tags: 'accent,deformable' },
    { name: 'wisp_l', parent: 'body', x: -0.35, y: 0.4, tags: 'accent,fx' },
    { name: 'wisp_r', parent: 'body', x: 0.35, y: 0.4, tags: 'accent,fx' },
    { name: 'weapon_anchor', parent: 'right_arm', x: 0.25, y: 0, tags: 'anchor' },
    { name: 'fx_anchor', parent: 'body', x: 0, y: -0.6, tags: 'anchor,fx' },
  ],

  ember: [
    { name: 'root', parent: null, x: 0, y: 0 },
    { name: 'body', parent: 'root', x: 0, y: 0, tags: 'body' },
    { name: 'chest', parent: 'body', x: 0, y: -0.15, tags: 'body' },
    { name: 'head', parent: 'chest', x: 0, y: -0.3, tags: 'face' },
    { name: 'face_anchor', parent: 'head', x: 0, y: 0, tags: 'face,anchor' },
    { name: 'flame_top', parent: 'head', x: 0, y: -0.35, tags: 'accent,deformable' },
    { name: 'flame_left', parent: 'body', x: -0.35, y: -0.1, tags: 'accent,deformable' },
    { name: 'flame_right', parent: 'body', x: 0.35, y: -0.1, tags: 'accent,deformable' },
    { name: 'left_arm', parent: 'chest', x: -0.35, y: 0.05, tags: 'limb' },
    { name: 'right_arm', parent: 'chest', x: 0.35, y: 0.05, tags: 'limb' },
    { name: 'weapon_anchor', parent: 'right_arm', x: 0.2, y: 0, tags: 'anchor' },
    { name: 'fx_anchor', parent: 'flame_top', x: 0, y: -0.2, tags: 'anchor,fx' },
  ],

  brute: [
    { name: 'root', parent: null, x: 0, y: 0 },
    { name: 'body', parent: 'root', x: 0, y: 0, tags: 'body' },
    { name: 'chest', parent: 'body', x: 0, y: -0.05, tags: 'body' },
    { name: 'head', parent: 'chest', x: 0, y: -0.10, tags: 'face' },
    { name: 'face_anchor', parent: 'head', x: 0, y: 0, tags: 'face,anchor' },
    { name: 'jaw_anchor', parent: 'head', x: 0, y: 0.04, tags: 'face,anchor' },
    { name: 'left_shoulder', parent: 'chest', x: -0.35, y: 0.0, tags: 'body' },
    { name: 'right_shoulder', parent: 'chest', x: 0.35, y: 0.0, tags: 'body' },
    { name: 'left_arm', parent: 'left_shoulder', x: -0.06, y: 0.10, tags: 'limb' },
    { name: 'right_arm', parent: 'right_shoulder', x: 0.06, y: 0.10, tags: 'limb' },
    { name: 'left_hand', parent: 'left_arm', x: -0.03, y: 0.10, tags: 'limb' },
    { name: 'right_hand', parent: 'right_arm', x: 0.03, y: 0.10, tags: 'limb' },
    { name: 'weapon_anchor', parent: 'right_hand', x: 0.1, y: 0, tags: 'anchor' },
    { name: 'shield_anchor', parent: 'left_hand', x: -0.1, y: 0, tags: 'anchor' },
    { name: 'back_anchor', parent: 'chest', x: 0, y: 0.05, tags: 'anchor,deformable' },
    { name: 'fx_anchor', parent: 'body', x: 0, y: -0.15, tags: 'anchor,fx' },
  ],

  slime: [
    { name: 'root', parent: null, x: 0, y: 0 },
    { name: 'body', parent: 'root', x: 0, y: 0, tags: 'body' },
    { name: 'head', parent: 'body', x: 0, y: -0.2, tags: 'face' },
    { name: 'face_anchor', parent: 'head', x: 0, y: 0, tags: 'face,anchor' },
    { name: 'left_arm', parent: 'body', x: -0.35, y: 0.05, tags: 'limb' },
    { name: 'right_arm', parent: 'body', x: 0.35, y: 0.05, tags: 'limb' },
    { name: 'back_anchor', parent: 'body', x: 0, y: 0.2, tags: 'anchor' },
    { name: 'weapon_anchor', parent: 'right_arm', x: 0.15, y: 0, tags: 'anchor' },
    { name: 'fx_anchor', parent: 'body', x: 0, y: -0.4, tags: 'anchor,fx' },
  ],

  player: [
    { name: 'root', parent: null, x: 0, y: 0 },
    { name: 'body', parent: 'root', x: 0, y: 0, tags: 'body' },
    { name: 'chest', parent: 'body', x: 0, y: -0.15, tags: 'body' },
    { name: 'head', parent: 'chest', x: 0, y: -0.25, tags: 'face' },
    { name: 'face_anchor', parent: 'head', x: 0, y: 0, tags: 'face,anchor' },
    { name: 'left_arm', parent: 'chest', x: -0.35, y: 0.05, tags: 'limb' },
    { name: 'right_arm', parent: 'chest', x: 0.35, y: 0.05, tags: 'limb' },
    { name: 'weapon_anchor', parent: 'right_arm', x: 0.2, y: 0, tags: 'anchor' },
    { name: 'fx_anchor', parent: 'body', x: 0, y: -0.5, tags: 'anchor,fx' },
  ],
};

// ── Slot definitions ──
// Each archetype's visual attachment layout.

export const SLOT_DEFS = {
  ghost: [
    { name: 'body_glow', bone: 'body', drawOrder: -10, attachments: [
      attachment.accent('glow', { radius: 2.0 }),
    ]},
    { name: 'body_shape', bone: 'body', drawOrder: 0, attachments: [
      attachment.shape('wisp_body', { segments: 16 }),
    ]},
    // Ghost shape is SVG-traced — arms, head crest, eyes, and cloak detail
    // are all baked into the SVG paths rendered by drawWispBody.
  ],

  ember: [
    { name: 'body_glow', bone: 'body', drawOrder: -10, attachments: [
      attachment.accent('glow', { radius: 2.5 }),
    ]},
    { name: 'flame_l', bone: 'flame_left', drawOrder: -5, attachments: [
      attachment.accent('flame_tip', { size: 0.4, deformable: true,
        deformParams: { type: 'flutter', frequency: 8 } }),
    ]},
    { name: 'flame_r', bone: 'flame_right', drawOrder: -5, attachments: [
      attachment.accent('flame_tip', { size: 0.4, deformable: true,
        deformParams: { type: 'flutter', frequency: 8 } }),
    ]},
    { name: 'body_shape', bone: 'body', drawOrder: 0, attachments: [
      attachment.shape('flame_body', { segments: 10, flickerPoints: 4 }),
    ]},
    { name: 'core', bone: 'chest', drawOrder: 1, attachments: [
      attachment.feature('hot_core', { radius: 0.45 }),
    ]},
    { name: 'flame_top', bone: 'flame_top', drawOrder: 2, attachments: [
      attachment.accent('flame_tip', { size: 0.5, deformable: true,
        deformParams: { type: 'flutter', frequency: 10 } }),
    ]},
    { name: 'highlight', bone: 'body', drawOrder: 3, attachments: [
      attachment.feature('highlight', { radius: 0.25 }),
    ]},
    { name: 'eye_left', bone: 'face_anchor', drawOrder: 10, attachments: [
      attachment.eye('slit', { side: 'left', size: 0.15, offset: 0.2, spread: 0.4 }),
    ]},
    { name: 'eye_right', bone: 'face_anchor', drawOrder: 10, attachments: [
      attachment.eye('slit', { side: 'right', size: 0.15, offset: 0.2, spread: 0.4 }),
    ]},
  ],

  brute: [
    { name: 'body_glow', bone: 'body', drawOrder: -10, attachments: [
      attachment.accent('glow', { radius: 2.5 }),
    ]},
    { name: 'body_shape', bone: 'body', drawOrder: 0, attachments: [
      attachment.shape('hulk_body', { segments: 8, spikes: 4, spikeLength: 0.25 }),
    ]},
    { name: 'interior', bone: 'body', drawOrder: 1, attachments: [
      attachment.feature('dark_interior', { radius: 0.5 }),
    ]},
    { name: 'left_shoulder', bone: 'left_shoulder', drawOrder: 2, attachments: [
      attachment.shape('shoulder_pad', { size: 0.3 }),
    ]},
    { name: 'right_shoulder', bone: 'right_shoulder', drawOrder: 2, attachments: [
      attachment.shape('shoulder_pad', { size: 0.3 }),
    ]},
    { name: 'left_arm', bone: 'left_arm', drawOrder: 3, attachments: [
      attachment.shape('thick_arm', { length: 0.25 }),
    ]},
    { name: 'right_arm', bone: 'right_arm', drawOrder: 3, attachments: [
      attachment.shape('thick_arm', { length: 0.25 }),
    ]},
    { name: 'highlight', bone: 'chest', drawOrder: 4, attachments: [
      attachment.feature('highlight', { radius: 0.2 }),
    ]},
    { name: 'eye_left', bone: 'face_anchor', drawOrder: 10, attachments: [
      attachment.eye('angry', { side: 'left', size: 0.14, offset: 0.25, spread: 0.35 }),
    ]},
    { name: 'eye_right', bone: 'face_anchor', drawOrder: 10, attachments: [
      attachment.eye('angry', { side: 'right', size: 0.14, offset: 0.25, spread: 0.35 }),
    ]},
  ],

  slime: [
    { name: 'body_glow', bone: 'body', drawOrder: -10, attachments: [
      attachment.accent('glow', { radius: 2.5 }),
    ]},
    { name: 'body_shape', bone: 'body', drawOrder: 0, attachments: [
      attachment.shape('blob_body', { segments: 12 }),
    ]},
    { name: 'interior', bone: 'body', drawOrder: 1, attachments: [
      attachment.feature('dark_interior', { radius: 0.55 }),
    ]},
    { name: 'highlight', bone: 'body', drawOrder: 2, attachments: [
      attachment.feature('highlight', { radius: 0.25, offsetX: -0.2, offsetY: -0.25 }),
    ]},
    { name: 'left_arm', bone: 'left_arm', drawOrder: 3, attachments: [
      attachment.shape('nub', { size: 0.2 }),
    ]},
    { name: 'right_arm', bone: 'right_arm', drawOrder: 3, attachments: [
      attachment.shape('nub', { size: 0.2 }),
    ]},
    { name: 'eye_left', bone: 'face_anchor', drawOrder: 10, attachments: [
      attachment.eye('dot', { side: 'left', size: 0.18, offset: 0.3, spread: 0.5 }),
    ]},
    { name: 'eye_right', bone: 'face_anchor', drawOrder: 10, attachments: [
      attachment.eye('dot', { side: 'right', size: 0.18, offset: 0.3, spread: 0.5 }),
    ]},
  ],

  player: [
    { name: 'body_glow', bone: 'body', drawOrder: -10, attachments: [
      attachment.accent('glow', { radius: 2.5 }),
    ]},
    { name: 'body_shape', bone: 'body', drawOrder: 0, attachments: [
      attachment.shape('hero_body', { segments: 10 }),
    ]},
    { name: 'interior', bone: 'body', drawOrder: 1, attachments: [
      attachment.feature('dark_interior', { radius: 0.45 }),
    ]},
    { name: 'highlight', bone: 'chest', drawOrder: 2, attachments: [
      attachment.feature('highlight', { radius: 0.2 }),
    ]},
    { name: 'left_arm', bone: 'left_arm', drawOrder: 3, attachments: [
      attachment.shape('nub', { size: 0.18 }),
    ]},
    { name: 'right_arm', bone: 'right_arm', drawOrder: 3, attachments: [
      attachment.shape('nub', { size: 0.18 }),
    ]},
    { name: 'eye_left', bone: 'face_anchor', drawOrder: 10, attachments: [
      attachment.eye('dot', { side: 'left', size: 0.14, offset: 0.25, spread: 0.4 }),
    ]},
    { name: 'eye_right', bone: 'face_anchor', drawOrder: 10, attachments: [
      attachment.eye('dot', { side: 'right', size: 0.14, offset: 0.25, spread: 0.4 }),
    ]},
  ],
};

// ── Animation clip definitions ──

function makeClips(archetypeId) {
  // Shared clip patterns, customized per archetype
  const configs = {
    ghost: { idleSway: 0.06, moveStretch: 0.08, attackReach: 0.3, hitRecoil: 0.15, deathDur: 0.5 },
    ember: { idleSway: 0.04, moveStretch: 0.1, attackReach: 0.25, hitRecoil: 0.2, deathDur: 0.35 },
    brute: { idleSway: 0.02, moveStretch: 0.04, attackReach: 0.4, hitRecoil: 0.08, deathDur: 0.6 },
    slime: { idleSway: 0.08, moveStretch: 0.12, attackReach: 0.2, hitRecoil: 0.15, deathDur: 0.4 },
    player: { idleSway: 0.03, moveStretch: 0.06, attackReach: 0.35, hitRecoil: 0.12, deathDur: 0.5 },
  };
  const c = configs[archetypeId] || configs.slime;

  return {
    idle: createClip('idle', 2.0, true, [
      createTrack('body', 'rotation', [
        kf(0, -c.idleSway), kf(0.5, c.idleSway), kf(1, -c.idleSway),
      ]),
      createTrack('body', 'scaleX', [
        kf(0, 1), kf(0.5, 1.02), kf(1, 1),
      ]),
      createTrack('body', 'scaleY', [
        kf(0, 1.01), kf(0.5, 0.99), kf(1, 1.01),
      ]),
    ]),

    locomotion: createClip('locomotion', 0.5, true, [
      createTrack('body', 'y', [
        kf(0, 0), kf(0.25, -1), kf(0.5, 0), kf(0.75, -0.5), kf(1, 0),
      ]),
      createTrack('body', 'scaleX', [
        kf(0, 1 + c.moveStretch), kf(0.25, 1 - c.moveStretch * 0.3),
        kf(0.5, 1 + c.moveStretch), kf(0.75, 1 - c.moveStretch * 0.3), kf(1, 1 + c.moveStretch),
      ]),
      createTrack('body', 'scaleY', [
        kf(0, 1 - c.moveStretch * 0.5), kf(0.25, 1 + c.moveStretch * 0.3),
        kf(0.5, 1 - c.moveStretch * 0.5), kf(0.75, 1 + c.moveStretch * 0.3), kf(1, 1 - c.moveStretch * 0.5),
      ]),
      createTrack('head', 'rotation', [
        kf(0, 0), kf(0.25, 0.03), kf(0.5, 0), kf(0.75, -0.03), kf(1, 0),
      ]),
    ]),

    attack: createClip('attack', 0.4, false, [
      // Wind-up (0-0.3) → strike (0.3-0.5) → recover (0.5-1)
      createTrack('body', 'rotation', [
        kf(0, 0), kf(0.3, -0.1, 'ease-in'), kf(0.5, 0.15, 'ease-out'), kf(1, 0, 'ease-out'),
      ]),
      createTrack('body', 'x', [
        kf(0, 0), kf(0.3, -c.attackReach * 0.5, 'ease-in'),
        kf(0.5, c.attackReach, 'ease-out'), kf(1, 0, 'ease-out'),
      ]),
      createTrack('body', 'scaleX', [
        kf(0, 1), kf(0.3, 0.95), kf(0.5, 1.1), kf(1, 1),
      ]),
    ]),

    hit_react: createClip('hit_react', 0.2, false, [
      createTrack('body', 'x', [
        kf(0, 0), kf(0.2, -c.hitRecoil, 'ease-out'), kf(0.7, c.hitRecoil * 0.3), kf(1, 0, 'ease-out'),
      ]),
      createTrack('body', 'scaleX', [
        kf(0, 1), kf(0.15, 1.08), kf(0.5, 0.97), kf(1, 1),
      ]),
      createTrack('body', 'scaleY', [
        kf(0, 1), kf(0.15, 0.94), kf(0.5, 1.02), kf(1, 1),
      ]),
    ]),

    dying: createClip('dying', c.deathDur, false, [
      createTrack('body', 'scaleX', [
        kf(0, 1), kf(0.3, 1.15, 'ease-out'), kf(1, 0.3, 'ease-in'),
      ]),
      createTrack('body', 'scaleY', [
        kf(0, 1), kf(0.3, 0.85), kf(1, 0.2, 'ease-in'),
      ]),
      createTrack('body', 'rotation', [
        kf(0, 0), kf(1, 0.3),
      ]),
    ]),
  };
}

function makeBruteClips() {
  return {
    idle: createClip('idle', 2.5, true, [
      createTrack('body', 'rotation', [
        kf(0, -0.015), kf(0.5, 0.015), kf(1, -0.015),
      ]),
      createTrack('body', 'scaleY', [
        kf(0, 1.01), kf(0.5, 0.99), kf(1, 1.01),
      ]),
      // Arms hang and sway gently
      createTrack('left_arm', 'rotation', [
        kf(0, 0.04), kf(0.5, -0.04), kf(1, 0.04),
      ]),
      createTrack('right_arm', 'rotation', [
        kf(0, -0.04), kf(0.5, 0.04), kf(1, -0.04),
      ]),
      // Hands droop
      createTrack('left_hand', 'rotation', [
        kf(0, 0.03), kf(0.5, -0.02), kf(1, 0.03),
      ]),
      createTrack('right_hand', 'rotation', [
        kf(0, -0.03), kf(0.5, 0.02), kf(1, -0.03),
      ]),
    ]),

    locomotion: createClip('locomotion', 0.8, true, [
      // Heavy body bounce — subtle at rootScale 16 (~2px)
      createTrack('body', 'y', [
        kf(0, 0), kf(0.25, -0.12), kf(0.5, 0), kf(0.75, -0.06), kf(1, 0),
      ]),
      createTrack('body', 'scaleX', [
        kf(0, 1.03), kf(0.25, 0.98), kf(0.5, 1.03), kf(0.75, 0.98), kf(1, 1.03),
      ]),
      createTrack('body', 'scaleY', [
        kf(0, 0.97), kf(0.25, 1.02), kf(0.5, 0.97), kf(0.75, 1.02), kf(1, 0.97),
      ]),
      // Head nods with each step (rotation only — y follows body through hierarchy)
      createTrack('head', 'rotation', [
        kf(0, 0.02), kf(0.25, -0.03), kf(0.5, 0.02), kf(0.75, -0.01), kf(1, 0.02),
      ]),
      // Shoulders rock via rotation (no y — they follow body through hierarchy)
      createTrack('left_shoulder', 'rotation', [
        kf(0, 0.03), kf(0.25, -0.06), kf(0.5, 0.03), kf(0.75, 0.06), kf(1, 0.03),
      ]),
      createTrack('right_shoulder', 'rotation', [
        kf(0, -0.03), kf(0.25, 0.06), kf(0.5, -0.03), kf(0.75, -0.06), kf(1, -0.03),
      ]),
      // Arms swing in opposition — big pendulum
      createTrack('left_arm', 'rotation', [
        kf(0, -0.25), kf(0.25, 0.25), kf(0.5, -0.25), kf(0.75, 0.25), kf(1, -0.25),
      ]),
      createTrack('right_arm', 'rotation', [
        kf(0, 0.25), kf(0.25, -0.25), kf(0.5, 0.25), kf(0.75, -0.25), kf(1, 0.25),
      ]),
      // Hands follow-through with delay
      createTrack('left_hand', 'rotation', [
        kf(0, -0.15), kf(0.3, 0.2), kf(0.55, -0.15), kf(0.8, 0.2), kf(1, -0.15),
      ]),
      createTrack('right_hand', 'rotation', [
        kf(0, 0.2), kf(0.3, -0.15), kf(0.55, 0.2), kf(0.8, -0.15), kf(1, 0.2),
      ]),
    ]),

    attack: createClip('attack', 0.5, false, [
      createTrack('body', 'rotation', [
        kf(0, 0), kf(0.3, -0.12, 'ease-in'), kf(0.5, 0.18, 'ease-out'), kf(1, 0, 'ease-out'),
      ]),
      createTrack('body', 'x', [
        kf(0, 0), kf(0.3, -0.2, 'ease-in'), kf(0.5, 0.4, 'ease-out'), kf(1, 0, 'ease-out'),
      ]),
      createTrack('right_arm', 'rotation', [
        kf(0, 0), kf(0.25, -0.5, 'ease-in'), kf(0.45, 0.6, 'ease-out'), kf(1, 0, 'ease-out'),
      ]),
      createTrack('right_hand', 'rotation', [
        kf(0, 0), kf(0.2, -0.3), kf(0.5, 0.4, 'ease-out'), kf(1, 0),
      ]),
    ]),

    hit_react: createClip('hit_react', 0.25, false, [
      createTrack('body', 'x', [
        kf(0, 0), kf(0.2, -0.08, 'ease-out'), kf(0.7, 0.03), kf(1, 0, 'ease-out'),
      ]),
      createTrack('body', 'scaleX', [
        kf(0, 1), kf(0.15, 1.06), kf(0.5, 0.98), kf(1, 1),
      ]),
      createTrack('body', 'scaleY', [
        kf(0, 1), kf(0.15, 0.95), kf(0.5, 1.01), kf(1, 1),
      ]),
      // Arms flinch inward
      createTrack('left_arm', 'rotation', [
        kf(0, 0), kf(0.15, -0.3), kf(1, 0, 'ease-out'),
      ]),
      createTrack('right_arm', 'rotation', [
        kf(0, 0), kf(0.15, 0.3), kf(1, 0, 'ease-out'),
      ]),
    ]),

    dying: createClip('dying', 0.6, false, [
      createTrack('body', 'scaleX', [
        kf(0, 1), kf(0.3, 1.12, 'ease-out'), kf(1, 0.4, 'ease-in'),
      ]),
      createTrack('body', 'scaleY', [
        kf(0, 1), kf(0.3, 0.88), kf(1, 0.25, 'ease-in'),
      ]),
      createTrack('body', 'rotation', [
        kf(0, 0), kf(1, 0.25),
      ]),
      // Arms go limp
      createTrack('left_arm', 'rotation', [
        kf(0, 0), kf(0.5, 0.4), kf(1, 0.6),
      ]),
      createTrack('right_arm', 'rotation', [
        kf(0, 0), kf(0.5, -0.4), kf(1, -0.6),
      ]),
    ]),
  };
}

export const CLIP_DEFS = {
  ghost: makeClips('ghost'),
  ember: makeClips('ember'),
  brute: makeBruteClips(),
  slime: makeClips('slime'),
  player: makeClips('player'),
};

// ── Animation state configs ──

export const STATE_CONFIGS = {
  idle: { clip: 'idle', loop: true, blendIn: 0.15 },
  locomotion: { clip: 'locomotion', loop: true, blendIn: 0.1 },
  attack: { clip: 'attack', loop: false, next: 'idle', blendIn: 0.05, priority: 1 },
  hit_react: { clip: 'hit_react', loop: false, next: 'idle', blendIn: 0.03, priority: 2 },
  dying: { clip: 'dying', loop: false, blendIn: 0.05, priority: 3 },
};

// ── Expression profiles ──

export const EXPRESSION_PROFILES = {
  ghost: {
    expressions: {
      neutral: {
        eyeParams: { openness: 1.0, glow: 0.8 },
        browParams: { angle: 0 },
      },
      angry: {
        eyeParams: { openness: 0.7, glow: 1.2 },
        browParams: { angle: -0.2 },
        blendSpeed: 8,
      },
      surprised: {
        eyeParams: { openness: 1.4, glow: 1.0 },
        browParams: { angle: 0.15 },
        blendSpeed: 10,
      },
      hurt: {
        eyeParams: { openness: 0.4, glow: 0.5 },
        browParams: { angle: -0.1 },
        blendSpeed: 12,
      },
      dead: {
        eyeParams: { openness: 0, glow: 0 },
        browParams: { angle: 0 },
        blendSpeed: 3,
      },
      focused: {
        eyeParams: { openness: 0.85, glow: 0.9 },
        browParams: { angle: -0.05 },
      },
    },
    blinkConfig: { interval: [3, 6], duration: 0.15 },
  },

  ember: {
    expressions: {
      neutral: {
        eyeParams: { openness: 1.0, slitWidth: 0.4 },
        browParams: {},
      },
      angry: {
        eyeParams: { openness: 0.6, slitWidth: 0.2 },
        browParams: {},
        blendSpeed: 10,
      },
      surprised: {
        eyeParams: { openness: 1.3, slitWidth: 0.6 },
        browParams: {},
        blendSpeed: 12,
      },
      hurt: {
        eyeParams: { openness: 0.3, slitWidth: 0.5 },
        browParams: {},
        blendSpeed: 15,
      },
      dead: {
        eyeParams: { openness: 0, slitWidth: 0 },
        browParams: {},
        blendSpeed: 3,
      },
      focused: {
        eyeParams: { openness: 0.8, slitWidth: 0.3 },
        browParams: {},
      },
    },
    blinkConfig: { interval: [4, 8], duration: 0.1 },
  },

  brute: {
    expressions: {
      neutral: {
        eyeParams: { openness: 0.9, intensity: 0.7 },
        browParams: { angle: -0.1, thickness: 1.0 },
      },
      angry: {
        eyeParams: { openness: 0.7, intensity: 1.5 },
        browParams: { angle: -0.3, thickness: 1.3 },
        blendSpeed: 6,
      },
      surprised: {
        eyeParams: { openness: 1.2, intensity: 0.8 },
        browParams: { angle: 0.2, thickness: 0.8 },
        blendSpeed: 8,
      },
      hurt: {
        eyeParams: { openness: 0.5, intensity: 0.4 },
        browParams: { angle: -0.15, thickness: 1.0 },
        blendSpeed: 10,
      },
      dead: {
        eyeParams: { openness: 0.1, intensity: 0 },
        browParams: { angle: 0, thickness: 0.5 },
        blendSpeed: 2,
      },
      focused: {
        eyeParams: { openness: 0.8, intensity: 1.0 },
        browParams: { angle: -0.2, thickness: 1.1 },
      },
    },
    blinkConfig: { interval: [3, 5], duration: 0.18 },
  },

  slime: {
    expressions: {
      neutral: {
        eyeParams: { openness: 1.0, size: 1.0 },
        browParams: {},
      },
      angry: {
        eyeParams: { openness: 0.8, size: 0.9 },
        browParams: {},
        blendSpeed: 8,
      },
      surprised: {
        eyeParams: { openness: 1.5, size: 1.2 },
        browParams: {},
        blendSpeed: 12,
      },
      hurt: {
        eyeParams: { openness: 0.3, size: 0.7 },
        browParams: {},
        blendSpeed: 15,
      },
      dead: {
        eyeParams: { openness: 0, size: 0 },
        browParams: {},
        blendSpeed: 3,
      },
      focused: {
        eyeParams: { openness: 0.9, size: 1.0 },
        browParams: {},
      },
    },
    blinkConfig: { interval: [2, 4], duration: 0.1 },
  },

  player: {
    expressions: {
      neutral: {
        eyeParams: { openness: 1.0, size: 1.0 },
        browParams: {},
      },
      angry: {
        eyeParams: { openness: 0.85, size: 0.95 },
        browParams: {},
        blendSpeed: 8,
      },
      surprised: {
        eyeParams: { openness: 1.3, size: 1.1 },
        browParams: {},
        blendSpeed: 10,
      },
      hurt: {
        eyeParams: { openness: 0.4, size: 0.8 },
        browParams: {},
        blendSpeed: 12,
      },
      dead: {
        eyeParams: { openness: 0, size: 0 },
        browParams: {},
        blendSpeed: 3,
      },
      focused: {
        eyeParams: { openness: 0.95, size: 1.0 },
        browParams: {},
      },
    },
    blinkConfig: { interval: [3, 5], duration: 0.12 },
  },
};

// ── Overlay configurations per archetype ──

export const OVERLAY_CONFIGS = {
  ghost: {
    breathing: { amp: 0.025, freq: 0.8, bones: ['body', 'chest'] },
    hover_bob: { amp: 0.8, freq: 0.6 },
    recoil: { magnitude: 4 },
    head_look: { maxAngle: 0.25 },
  },
  ember: {
    breathing: { amp: 0.04, freq: 1.5, bones: ['body'] },
    recoil: { magnitude: 3 },
    head_look: { maxAngle: 0.2 },
  },
  brute: {
    breathing: { amp: 0.02, freq: 0.5, bones: ['body', 'chest'] },
    recoil: { magnitude: 2, bone: 'chest' },
    tension: { lean: 0.06, bone: 'chest' },
    head_look: { maxAngle: 0.15 },
  },
  slime: {
    breathing: { amp: 0.04, freq: 1.0, bones: ['body'] },
    recoil: { magnitude: 3.5 },
    head_look: { maxAngle: 0.3 },
  },
  player: {
    breathing: { amp: 0.03, freq: 1.0, bones: ['body', 'chest'] },
    recoil: { magnitude: 2.5 },
    head_look: { maxAngle: 0.2 },
  },
};
