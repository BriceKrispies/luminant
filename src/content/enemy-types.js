/**
 * Enemy archetype definitions.
 * Each key maps to spawn parameters matching the engine's entity layout.
 */

import { TYPE } from '../engine/bindings.js';

export const ENEMY_DEFS = {
  basic: {
    type: TYPE.ENEMY_BASIC,
    hp: 30,
    speed: 60,
    radius: 10,
    damage: 8,
    xp: 10,
    color: '#4a8',
    glowColor: 'rgba(60, 200, 120, 0.4)',
    name: 'Creep',
  },
  fast: {
    type: TYPE.ENEMY_FAST,
    hp: 15,
    speed: 120,
    radius: 7,
    damage: 5,
    xp: 8,
    color: '#e84',
    glowColor: 'rgba(240, 120, 60, 0.4)',
    name: 'Runner',
  },
  tank: {
    type: TYPE.ENEMY_TANK,
    hp: 120,
    speed: 35,
    radius: 16,
    damage: 20,
    xp: 30,
    color: '#a4e',
    glowColor: 'rgba(160, 80, 230, 0.5)',
    name: 'Brute',
  },
  ranged: {
    type: TYPE.ENEMY_RANGED,
    hp: 25,
    speed: 45,
    radius: 9,
    damage: 12,
    xp: 15,
    color: '#ea4',
    glowColor: 'rgba(230, 180, 60, 0.4)',
    name: 'Spitter',
  },
};

/** Reverse lookup: engine type -> def key */
export const TYPE_TO_KEY = {};
for (const [key, def] of Object.entries(ENEMY_DEFS)) {
  TYPE_TO_KEY[def.type] = key;
}
