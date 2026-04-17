/**
 * Skill / upgrade system.
 * Offers tiered upgrade choices on level-up.
 * Manages stat recalculation and behavioral effect flags.
 *
 * Tier 1 (level 1): weapon choice — forces build identity early
 * Tier 2 (level 2): signature modifier — reinforces the choice
 * Tier 3+ (level 3+): general power upgrades
 */

import { UPGRADE_POOL } from '../content/upgrade-pool.js';
import { getArchetype } from '../content/archetypes.js';

export function createSkillSystem(player, weapons) {
  const acquired = [];         // upgrade IDs picked (may repeat for stacks)
  let levelUpCount = 0;        // how many level-ups have been processed
  let archetypeId = null;      // applied once per run, before any upgrades

  let statBonuses = freshStats();
  const effects = new Set();   // active behavioral effect names
  const effectData = {};       // per-effect data (pierce count, heal amount, etc.)

  // Behavioral state
  let hitCounter = 0;          // for explosive_fifth
  let stillTimer = 0;          // for focus_fire
  let wasMoving = false;

  function freshStats() {
    return {
      speedBonus: 0,
      maxHpBonus: 0,
      damageMultiplier: 1,
      cooldownMultiplier: 1,
      projectileSpeedBonus: 0,
      pickupRadius: 0,
      armor: 0,
      regenRate: 0,
      stunDurationBonus: 0,
      coneAngleBonus: 0,
      pierceCount: 0,
      healPerKill: 0,
      thornsDamage: 0,
    };
  }

  function recalcStats() {
    const b = freshStats();

    // Archetype contribution (applied before upgrades).
    const arch = archetypeId ? getArchetype(archetypeId) : null;
    if (arch && arch.stats) {
      const s = arch.stats;
      if (s.armor) b.armor += s.armor;
      if (s.regenRate) b.regenRate += s.regenRate;
      if (s.pickupRadius) b.pickupRadius += s.pickupRadius;
    }

    for (const id of acquired) {
      const upg = UPGRADE_POOL.find(u => u.id === id);
      if (!upg) continue;
      if (upg.speedBonus) b.speedBonus += upg.speedBonus;
      if (upg.maxHpBonus) b.maxHpBonus += upg.maxHpBonus;
      if (upg.damageMultiplier) b.damageMultiplier *= upg.damageMultiplier;
      if (upg.cooldownMultiplier) b.cooldownMultiplier *= upg.cooldownMultiplier;
      if (upg.projectileSpeedBonus) b.projectileSpeedBonus += upg.projectileSpeedBonus;
      if (upg.pickupRadius) b.pickupRadius += upg.pickupRadius;
      if (upg.armor) b.armor += upg.armor;
      if (upg.regenRate) b.regenRate += upg.regenRate;
      if (upg.stunDurationBonus) b.stunDurationBonus += upg.stunDurationBonus;
      if (upg.coneAngleBonus) b.coneAngleBonus += upg.coneAngleBonus;
      if (upg.pierceCount) b.pierceCount += upg.pierceCount;
      if (upg.healPerKill) b.healPerKill += upg.healPerKill;
      if (upg.thornsDamage) b.thornsDamage += upg.thornsDamage;
    }

    statBonuses = b;
    weapons.damageMultiplier = b.damageMultiplier;
    weapons.cooldownMultiplier = b.cooldownMultiplier;
    weapons.projectileSpeedMultiplier = 1 + b.projectileSpeedBonus;
  }

  return {
    get acquired() { return acquired; },
    get stats() { return statBonuses; },
    get activeEffects() { return effects; },
    get levelUpCount() { return levelUpCount; },

    hasEffect(name) { return effects.has(name); },
    getEffectData(name) { return effectData[name]; },

    // --- Behavioral state for systems to query ---

    /** Called by weapons on each hit to track combo counters */
    onHit() {
      hitCounter++;
      return hitCounter;
    },

    /** Returns true if this hit should trigger the explosive 5th */
    shouldExplode() {
      if (!effects.has('explosive_fifth')) return false;
      if (hitCounter % 5 === 0) return true;
      return false;
    },

    /** Update standing-still timer for focus_fire */
    updateStillTimer(dt, isMoving) {
      if (!effects.has('focus_fire')) {
        stillTimer = 0;
        return;
      }
      if (isMoving) {
        stillTimer = Math.max(0, stillTimer - dt * 3); // decay fast
      } else {
        stillTimer = Math.min(stillTimer + dt, 2); // ramp over 2s
      }
    },

    /** Get focus_fire damage multiplier (1.0 to 1.6) */
    getFocusDamageMultiplier() {
      if (!effects.has('focus_fire')) return 1;
      return 1 + (stillTimer / 2) * 0.6;
    },

    /** Get berserker cooldown multiplier (checks player HP) */
    getBerserkerCooldownMultiplier() {
      if (!effects.has('berserker')) return 1;
      const hp = player.getHP();
      const maxHp = player.getMaxHP();
      if (hp / maxHp < 0.5) return 0.2; // 80% faster fire rate
      return 1;
    },

    /** Get N upgrade options, respecting tier rules */
    getUpgradeChoices(count = 3) {
      levelUpCount++;
      const pickLevel = levelUpCount;

      let tierFilter;
      if (pickLevel === 1) {
        tierFilter = 1; // weapon choice only
      } else if (pickLevel === 2) {
        tierFilter = 2; // signature only
      } else {
        tierFilter = 3; // general pool
      }

      const available = UPGRADE_POOL.filter(u => {
        if ((u.tier || 3) !== tierFilter) return false;
        const timesAcquired = acquired.filter(id => id === u.id).length;
        return timesAcquired < (u.maxStacks || 1);
      });

      const shuffled = [...available].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, count);
    },

    /**
     * Apply a run-start archetype. Sets starting weapon and stat modifiers.
     * Safe no-op if id is unknown. Must be called before the tick loop.
     */
    applyArchetype(id) {
      const arch = getArchetype(id);
      if (!arch) return;
      archetypeId = arch.id;
      if (arch.weapon) weapons.currentWeapon = arch.weapon;
      const s = arch.stats || {};
      if (s.maxHpBonus) player.modifyMaxHP(s.maxHpBonus);
      if (s.speedBonus) player.modifySpeed(s.speedBonus);
      // Stats that flow through recalcStats are picked up automatically there.
      recalcStats();
    },

    get archetypeId() { return archetypeId; },

    applyUpgrade(upgradeId) {
      acquired.push(upgradeId);
      const upg = UPGRADE_POOL.find(u => u.id === upgradeId);
      recalcStats();

      if (upg) {
        if (upg.maxHpBonus) player.modifyMaxHP(upg.maxHpBonus);
        if (upg.speedBonus) player.modifySpeed(upg.speedBonus);
        if (upg.healOnPickup) player.heal(player.getMaxHP() * 0.25);
        if (upg.weapon) weapons.currentWeapon = upg.weapon;

        // Register behavioral effect
        if (upg.effect) {
          effects.add(upg.effect);
          // Store any per-effect numeric data
          effectData[upg.effect] = {
            pierceCount: upg.pierceCount || 0,
            healPerKill: upg.healPerKill || 0,
            thornsDamage: upg.thornsDamage || 0,
          };
        }
      }
    },

    isUnlocked(nodeId) {
      return acquired.includes(nodeId);
    },

    getSkillLevel(nodeId) {
      return acquired.filter(id => id === nodeId).length;
    },

    reset() {
      acquired.length = 0;
      levelUpCount = 0;
      archetypeId = null;
      statBonuses = freshStats();
      effects.clear();
      for (const k in effectData) delete effectData[k];
      hitCounter = 0;
      stillTimer = 0;
    },
  };
}
