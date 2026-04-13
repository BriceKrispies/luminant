/**
 * Stat system — centralized stat resolution.
 * Combines base stats with skill bonuses, status effects, and item modifiers.
 */

export function createStatSystem() {
  const baseStats = {
    speed: 180,
    maxHp: 100,
    damage: 1,
    armor: 0,
    regen: 0,
    pickupRadius: 30,
    xpMultiplier: 1,
  };

  const modifiers = [];

  return {
    get base() { return { ...baseStats }; },

    addModifier(id, stats) {
      modifiers.push({ id, ...stats });
    },

    removeModifier(id) {
      const idx = modifiers.findIndex(m => m.id === id);
      if (idx >= 0) modifiers.splice(idx, 1);
    },

    /** Resolve final stats by applying all modifiers */
    resolve() {
      const result = { ...baseStats };
      for (const mod of modifiers) {
        if (mod.speed) result.speed += mod.speed;
        if (mod.maxHp) result.maxHp += mod.maxHp;
        if (mod.damage) result.damage += mod.damage;
        if (mod.armor) result.armor += mod.armor;
        if (mod.regen) result.regen += mod.regen;
        if (mod.pickupRadius) result.pickupRadius += mod.pickupRadius;
        if (mod.xpMultiplier) result.xpMultiplier *= mod.xpMultiplier;
      }
      return result;
    },

    reset() {
      modifiers.length = 0;
    },
  };
}
