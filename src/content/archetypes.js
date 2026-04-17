/**
 * Player archetype pool.
 *
 * An archetype is a run-start choice that shapes the early game by applying
 * starting stat modifiers and/or a starting weapon. It is the first decision
 * the decision system resolves at the beginning of every run.
 *
 * Archetypes are applied by `skills.applyArchetype(id)` which sets starting
 * stats and weapon before the tick loop begins. They do NOT replace the
 * level-1 weapon-upgrade pick — they bias it.
 *
 * Shape:
 *   id      — stable identifier (recorded in decisionHistory)
 *   name    — human-readable label
 *   desc    — one-line description
 *   weapon? — starting weapon id (overrides default 'sword')
 *   stats?  — { maxHpBonus, speedBonus, armor, regenRate, pickupRadius }
 */

export const ARCHETYPES = [
  {
    id: 'balanced',
    name: 'Balanced',
    desc: 'No modifiers — a neutral starting point.',
  },
  {
    id: 'warrior',
    name: 'Warrior',
    desc: '+30 max HP, +2 armor. Tanky melee opener.',
    weapon: 'sword',
    stats: { maxHpBonus: 30, armor: 2 },
  },
  {
    id: 'ranger',
    name: 'Ranger',
    desc: 'Shotgun start, +20 speed, +30 pickup radius.',
    weapon: 'shotgun',
    stats: { speedBonus: 20, pickupRadius: 30 },
  },
  {
    id: 'mystic',
    name: 'Mystic',
    desc: 'Nova start, +0.6 regen/sec. Sustain through attrition.',
    weapon: 'nova',
    stats: { regenRate: 0.6 },
  },
];

export const DEFAULT_ARCHETYPE_ID = 'balanced';

export function getArchetype(id) {
  return ARCHETYPES.find(a => a.id === id) || null;
}
