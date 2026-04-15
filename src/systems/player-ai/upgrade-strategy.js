export function createUpgradeStrategy(weights) {
  const w = weights.upgradeWeights || {
    survivability: 1, damage: 1, aoe: 1, speed: 1, utility: 1, scaling: 1,
  };

  return {
    choose(choices, obs) {
      if (choices.length === 0) return null;

      let bestId = choices[0].id;
      let bestScore = -Infinity;

      for (const c of choices) {
        let score = scoreBase(c, w, obs);
        score += weaponSynergy(c, obs, weights);

        if (c.maxStacks > 1 && obs.acquiredUpgrades.includes(c.id)) {
          score *= 1.25;
        }

        if (obs.hpRatio < 0.3 && (c.healOnPickup || c.maxHpBonus || c.regenRate)) {
          score += 2;
        }

        if (score > bestScore) {
          bestScore = score;
          bestId = c.id;
        }
      }

      return bestId;
    },
  };
}

function scoreBase(c, w, obs) {
  let score = 0;

  // Survivability
  if (c.maxHpBonus) score += w.survivability * 2;
  if (c.armor) score += w.survivability * 1.5;
  if (c.regenRate) score += w.survivability * 2;
  if (c.healOnPickup) score += w.survivability * (obs.hpRatio < 0.5 ? 3 : 1);
  if (c.healPerKill) score += w.survivability * 1.2;
  if (c.effect === 'thorns') score += w.survivability * 1.5;

  // Damage
  if (c.damageMultiplier && c.damageMultiplier > 1) score += w.damage * 2;
  if (c.cooldownMultiplier && c.cooldownMultiplier < 1) score += w.damage * 1.8;
  if (c.stunDurationBonus) score += w.damage * 0.8;
  if (c.effect === 'focus_fire') score += w.damage * 1.5;
  if (c.effect === 'berserker') score += w.damage * 1.8;

  // AoE
  if (c.effect === 'kill_shockwave') score += w.aoe * 2.5;
  if (c.effect === 'explosive_fifth') score += w.aoe * 2;
  if (c.weapon === 'nova') score += w.aoe * 2;
  if (c.weapon === 'shotgun') score += w.aoe * 1.5;
  if (c.weapon === 'sword' || c.effect === 'sword_mastery') score += w.aoe * 1;

  // Speed
  if (c.speedBonus) score += w.speed * 1.5;
  if (c.effect === 'speed_on_kill') score += w.speed * 2;

  // Utility
  if (c.pickupRadius) score += w.utility * 1.5;
  if (c.effect === 'magnet_heal') score += w.utility * 2;
  if (c.pierceCount) score += w.utility * 1.5;

  // Scaling
  if (c.effect === 'scaling_regen') score += (w.scaling || 1) * (obs.level > 4 ? 2 : 1);
  if (c.effect === 'vampiric') score += (w.scaling || 1) * 1.5;

  return score;
}

function weaponSynergy(c, obs, policyWeights) {
  let bonus = 0;
  const wep = obs.weapon || 'sword';

  if (wep === 'sword') {
    if (c.effect === 'thorns') bonus += 1;
    if (c.maxHpBonus) bonus += 0.5;
    if (c.effect === 'berserker') bonus += 1;
  }

  if (wep === 'shotgun') {
    if (c.pierceCount) bonus += 1.5;
    if (c.damageMultiplier) bonus += 0.5;
  }

  if (wep === 'nova') {
    if (c.effect === 'kill_shockwave') bonus += 1;
    if (c.effect === 'explosive_fifth') bonus += 1;
  }

  // Weapon picks matching policy style
  if (c.weapon) {
    if ((policyWeights.survivalBias || 0) > 0.6 && c.weapon === 'sword') bonus += 1;
    if ((policyWeights.clusterPreference || 0) > 0.6 && c.weapon === 'nova') bonus += 1;
    if ((policyWeights.kite || 0) > 1.5 && c.weapon === 'shotgun') bonus += 1;
  }

  return bonus;
}
