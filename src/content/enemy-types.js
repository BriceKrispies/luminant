/**
 * Enemy archetype definitions.
 * Each key maps to spawn parameters matching the engine's entity layout.
 *
 * `behaviorId` selects the WAT steering branch — see BEHAVIOR in bindings.js.
 * Types 2-13 are enemies; projectiles 14-17; pickups 20+.
 */

import { TYPE, BEHAVIOR } from '../engine/bindings.js';

export const ENEMY_DEFS = {
  // --- Pursuers: beeline toward the player (baseline) ---
  basic: {
    type: TYPE.ENEMY_BASIC,
    behaviorId: BEHAVIOR.PURSUER,
    hp: 30, speed: 60, radius: 10, damage: 8, xp: 10,
    color: '#4a8',
    glowColor: 'rgba(60, 200, 120, 0.4)',
    name: 'Creep',
  },
  fast: {
    type: TYPE.ENEMY_FAST,
    behaviorId: BEHAVIOR.PURSUER,
    hp: 15, speed: 120, radius: 7, damage: 5, xp: 8,
    color: '#e84',
    glowColor: 'rgba(240, 120, 60, 0.4)',
    name: 'Runner',
  },
  tank: {
    type: TYPE.ENEMY_TANK,
    behaviorId: BEHAVIOR.PURSUER,
    hp: 120, speed: 35, radius: 16, damage: 20, xp: 30,
    color: '#a4e',
    glowColor: 'rgba(160, 80, 230, 0.5)',
    name: 'Brute',
  },

  // --- Shooter: kites at range and fires projectiles ---
  ranged: {
    type: TYPE.ENEMY_SHOOTER,
    behaviorId: BEHAVIOR.SHOOTER,
    hp: 25, speed: 45, radius: 9, damage: 8, xp: 15,
    color: '#ea4',
    glowColor: 'rgba(230, 180, 60, 0.4)',
    name: 'Spitter',
    projectileSpeed: 220,
    projectileDamage: 10,
  },

  // --- Movement archetypes ---
  orbiter: {
    type: TYPE.ENEMY_ORBITER,
    behaviorId: BEHAVIOR.ORBITER,
    hp: 35, speed: 75, radius: 8, damage: 9, xp: 14,
    color: '#6ce',
    glowColor: 'rgba(100, 200, 240, 0.45)',
    name: 'Orbwisp',
  },
  kiter: {
    type: TYPE.ENEMY_KITER,
    behaviorId: BEHAVIOR.KITER,
    hp: 20, speed: 90, radius: 7, damage: 6, xp: 12,
    color: '#fc6',
    glowColor: 'rgba(250, 220, 110, 0.45)',
    name: 'Skitter',
  },
  charger: {
    type: TYPE.ENEMY_CHARGER,
    behaviorId: BEHAVIOR.CHARGER,
    hp: 55, speed: 50, radius: 11, damage: 18, xp: 22,
    color: '#e66',
    glowColor: 'rgba(230, 90, 90, 0.55)',
    name: 'Ramhorn',
  },
  flanker: {
    type: TYPE.ENEMY_FLANKER,
    behaviorId: BEHAVIOR.FLANKER,
    hp: 25, speed: 100, radius: 8, damage: 7, xp: 12,
    color: '#ac6',
    glowColor: 'rgba(160, 220, 100, 0.45)',
    name: 'Shiver',
  },
  zigzag: {
    type: TYPE.ENEMY_ZIGZAG,
    behaviorId: BEHAVIOR.ZIGZAG,
    hp: 22, speed: 85, radius: 8, damage: 6, xp: 11,
    color: '#c6f',
    glowColor: 'rgba(190, 110, 250, 0.45)',
    name: 'Wisp',
  },
  ambusher: {
    type: TYPE.ENEMY_AMBUSHER,
    behaviorId: BEHAVIOR.AMBUSHER,
    hp: 40, speed: 70, radius: 9, damage: 15, xp: 20,
    color: '#777',
    glowColor: 'rgba(120, 120, 120, 0.35)',
    name: 'Stalker',
  },
  retreater: {
    type: TYPE.ENEMY_RETREATER,
    behaviorId: BEHAVIOR.RETREATER,
    hp: 30, speed: 80, radius: 9, damage: 8, xp: 12,
    color: '#9ac',
    glowColor: 'rgba(150, 180, 210, 0.45)',
    name: 'Coward',
  },
  summoner: {
    type: TYPE.ENEMY_SUMMONER,
    behaviorId: BEHAVIOR.SUMMONER,
    hp: 70, speed: 40, radius: 13, damage: 6, xp: 35,
    color: '#e8c',
    glowColor: 'rgba(230, 150, 200, 0.5)',
    name: 'Hexer',
    summonKey: 'basic',
    summonCount: 2,
  },
};

/** Reverse lookup: engine type -> def key */
export const TYPE_TO_KEY = {};
for (const [key, def] of Object.entries(ENEMY_DEFS)) {
  TYPE_TO_KEY[def.type] = key;
}
