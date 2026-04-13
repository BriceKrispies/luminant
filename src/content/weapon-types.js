/**
 * Weapon definitions.
 * pattern: 'single' | 'spread' | 'burst'
 */

import { TYPE } from '../engine/bindings.js';

export const WEAPON_DEFS = {
  sword: {
    name: 'Sword',
    pattern: 'cone',
    damage: 35,
    cooldown: 0.5,
    range: 75,
    coneAngle: 1.2,        // radians (~70 degrees total)
    stunDuration: 0.25,    // seconds enemies are slowed
    stunSpeedFactor: 0.15, // speed multiplied by this during stun
    color: '#fff',
    glowColor: 'rgba(255, 240, 200, 0.7)',
  },
  shotgun: {
    name: 'Shotgun',
    pattern: 'spread',
    damage: 8,
    cooldown: 0.6,
    projectileSpeed: 400,
    projectileRadius: 3,
    projectileType: TYPE.PROJECTILE_SPREAD,
    spreadAngle: 0.5,
    spreadCount: 5,
    lifetime: 0.6,
    color: '#f84',
    glowColor: 'rgba(255, 130, 60, 0.6)',
  },
  nova: {
    name: 'Nova',
    pattern: 'burst',
    damage: 12,
    cooldown: 1.2,
    projectileSpeed: 250,
    projectileRadius: 6,
    projectileType: TYPE.PROJECTILE_AOE,
    burstCount: 12,
    lifetime: 0.8,
    color: '#4cf',
    glowColor: 'rgba(60, 200, 255, 0.6)',
  },
};
