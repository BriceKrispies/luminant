/**
 * Upgrade pool — behavior-driven upgrades.
 *
 * Categories:
 *   'weapon'    — weapon choice (level 1 picks)
 *   'signature' — build-defining modifier (level 2 picks)
 *   'power'     — general upgrades (level 3+)
 *
 * Each upgrade has at least one behavioral modifier, not just a stat bump.
 * The `effect` field names the behavior; skills.js / weapons.js interpret it.
 */

export const UPGRADE_POOL = [
  // ── WEAPON CHOICES (offered at level 1) ──
  {
    id: 'sword_mastery',
    name: 'Blade Dancer',
    desc: 'Sword: wider cone, faster swing',
    category: 'weapon',
    tier: 1,
    maxStacks: 1,
    weapon: 'sword',
    effect: 'sword_mastery',
    cooldownMultiplier: 0.8,
    coneAngleBonus: 0.4,
  },
  {
    id: 'shotgun_unlock',
    name: 'Shotgun',
    desc: 'Switch to spread-fire shotgun',
    category: 'weapon',
    tier: 1,
    maxStacks: 1,
    weapon: 'shotgun',
  },
  {
    id: 'nova_unlock',
    name: 'Nova Burst',
    desc: 'Switch to 360-degree nova',
    category: 'weapon',
    tier: 1,
    maxStacks: 1,
    weapon: 'nova',
  },

  // ── SIGNATURE UPGRADES (offered at level 2) ──
  {
    id: 'pierce',
    name: 'Piercing Rounds',
    desc: 'Projectiles pierce through 2 enemies',
    category: 'signature',
    tier: 2,
    maxStacks: 1,
    effect: 'pierce',
    pierceCount: 2,
  },
  {
    id: 'kill_shockwave',
    name: 'Shockwave',
    desc: 'Kills create a small AoE burst',
    category: 'signature',
    tier: 2,
    maxStacks: 1,
    effect: 'kill_shockwave',
  },
  {
    id: 'berserker',
    name: 'Berserker',
    desc: 'Below 50% HP: +80% fire rate',
    category: 'signature',
    tier: 2,
    maxStacks: 1,
    effect: 'berserker',
  },
  {
    id: 'focus_fire',
    name: 'Focus Fire',
    desc: 'Standing still ramps damage up to +60%',
    category: 'signature',
    tier: 2,
    maxStacks: 1,
    effect: 'focus_fire',
  },

  // ── POWER UPGRADES (level 3+) ──
  {
    id: 'explosive_fifth',
    name: 'Chain Reaction',
    desc: 'Every 5th hit explodes for AoE damage',
    category: 'power',
    tier: 3,
    maxStacks: 1,
    effect: 'explosive_fifth',
  },
  {
    id: 'vampiric',
    name: 'Vampiric Strikes',
    desc: 'Heal 3 HP per kill',
    category: 'power',
    tier: 3,
    maxStacks: 2,
    effect: 'vampiric',
    healPerKill: 3,
  },
  {
    id: 'speed_on_kill',
    name: 'Adrenaline',
    desc: 'Kills grant +30% speed for 2s',
    category: 'power',
    tier: 3,
    maxStacks: 1,
    effect: 'speed_on_kill',
  },
  {
    id: 'armor_thorns',
    name: 'Thorns',
    desc: 'Taking damage deals 15 to nearby enemies',
    category: 'power',
    tier: 3,
    maxStacks: 2,
    effect: 'thorns',
    thornsDamage: 15,
    armor: 2,
  },
  {
    id: 'magnet_1',
    name: 'Magnet',
    desc: '+30 pickup radius, XP pickup heals 1 HP',
    category: 'power',
    tier: 3,
    maxStacks: 3,
    effect: 'magnet_heal',
    pickupRadius: 30,
  },
  {
    id: 'damage_1',
    name: 'Heavy Hits',
    desc: '+20% damage, attacks stun 10% longer',
    category: 'power',
    tier: 3,
    maxStacks: 3,
    damageMultiplier: 1.2,
    stunDurationBonus: 0.1,
  },
  {
    id: 'regen_1',
    name: 'Regeneration',
    desc: 'Heal 2 HP/sec, bonus +1/sec per level gained',
    category: 'power',
    tier: 3,
    maxStacks: 2,
    regenRate: 2,
    effect: 'scaling_regen',
  },
  {
    id: 'hp_1',
    name: 'Vitality',
    desc: '+30 max HP, heal for the amount',
    category: 'power',
    tier: 3,
    maxStacks: 4,
    maxHpBonus: 30,
  },
  {
    id: 'heal_now',
    name: 'First Aid',
    desc: 'Heal 25% of max HP instantly',
    category: 'power',
    tier: 3,
    maxStacks: 99,
    healOnPickup: true,
  },
  {
    id: 'speed_1',
    name: 'Quick Step',
    desc: '+15% move speed, brief dodge on direction change',
    category: 'power',
    tier: 3,
    maxStacks: 3,
    speedBonus: 27,
    effect: 'quick_dodge',
  },
];
