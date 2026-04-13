/**
 * Skill tree structure.
 * Nodes organized in tiers; each tier unlocks after reaching a level threshold.
 */

export const SKILL_TREE = {
  tiers: [
    {
      level: 1,
      nodes: [
        { id: 'swift', name: 'Swift Feet', desc: '+15% move speed', maxLevel: 3 },
        { id: 'tough', name: 'Toughness', desc: '+20 max HP', maxLevel: 3 },
        { id: 'sharp', name: 'Sharpshooter', desc: '+10% damage', maxLevel: 3 },
      ],
    },
    {
      level: 5,
      nodes: [
        { id: 'regen', name: 'Regeneration', desc: 'Heal 1 HP/sec', maxLevel: 3 },
        { id: 'magnet', name: 'Magnet', desc: '+50% pickup range', maxLevel: 2 },
        { id: 'rapid', name: 'Rapid Fire', desc: '-15% cooldown', maxLevel: 3 },
      ],
    },
    {
      level: 10,
      nodes: [
        { id: 'shotgun_unlock', name: 'Shotgun', desc: 'Unlock shotgun', maxLevel: 1, weapon: 'shotgun' },
        { id: 'nova_unlock', name: 'Nova', desc: 'Unlock nova', maxLevel: 1, weapon: 'nova' },
        { id: 'armor', name: 'Armor Plating', desc: 'Reduce damage by 3', maxLevel: 3 },
      ],
    },
    {
      level: 15,
      nodes: [
        { id: 'proj_speed', name: 'Velocity', desc: '+20% projectile speed', maxLevel: 3 },
        { id: 'xp_boost', name: 'XP Boost', desc: '+25% XP gain', maxLevel: 2 },
        { id: 'second_wind', name: 'Second Wind', desc: 'Heal 20% on level up', maxLevel: 1 },
      ],
    },
  ],
};
