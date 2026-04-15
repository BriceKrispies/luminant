export const INTENTIONS = [
  'flee', 'kite', 'hold_range', 'reposition_for_shot',
  'collapse_on_cluster', 'collect_xp', 'boss_focus',
  'maintain_pressure', 'hold_ground',
];

export function createUtilityScorer() {
  return {
    score(sensor, weights) {
      const intentionScores = scoreIntentions(sensor, weights);
      const candidates = scoreCandidates(sensor, intentionScores, weights);

      let bestIntention = 'hold_ground';
      let bestIntentionScore = -Infinity;
      for (const name of INTENTIONS) {
        if (intentionScores[name] > bestIntentionScore) {
          bestIntentionScore = intentionScores[name];
          bestIntention = name;
        }
      }

      return {
        intentionScores,
        bestIntention,
        bestIntentionScore,
        candidates,
        bestCandidate: candidates[0] || { dx: 0, dy: 0, score: 0 },
      };
    },
  };
}

function scoreIntentions(s, w) {
  const retreatThreshold = w.retreatThreshold || 0.3;
  const riskTolerance = w.damageRiskTolerance || 0.5;

  const scores = {};

  scores.flee =
    ((1 - s.hpRatio) * 3 +
    s.localThreat * 2 +
    s.encirclement * 2 +
    (s.nearEnemyCount >= 5 ? 3 : 0) +
    (s.recentDamageTaken > 0 ? 1 : 0) +
    (s.hpRatio < retreatThreshold ? 4 : 0)) *
    (w.flee || 1);

  scores.kite =
    ((s.nearestEnemyDist < s.preferredRange * 1.5 ? 2 : 0) +
    (s.weaponReady ? 2 : 0) +
    (s.hpRatio > 0.3 ? 1 : 0) +
    (s.nearEnemyCount >= 1 && s.nearEnemyCount <= 4 ? 2 : 0)) *
    (w.kite || 1);

  scores.hold_range =
    (Math.max(0, 2 - Math.abs(s.nearestEnemyDist - s.preferredRange) / s.preferredRange * 2) +
    (s.hpRatio > 0.5 ? 1 : 0) +
    (s.nearEnemyCount <= 3 ? 1 : 0)) *
    (w.hold_range || 1);

  scores.reposition_for_shot =
    ((s.weaponReady && s.enemiesInArc === 0 && s.nearestEnemyDist < s.weaponRange * 1.5 ? 4 : 0) +
    (s.nearEnemyCount >= 1 ? 1 : 0)) *
    (w.reposition_for_shot || 1);

  scores.collapse_on_cluster =
    ((s.clusteredSectors >= 2 || s.nearEnemyCount >= 4 ? s.nearEnemyCount * 0.5 : 0) +
    (s.hpRatio > 0.5 ? 1 : 0) +
    (s.weapon !== 'sword' ? 1 : 0) +
    (s.hpRatio > riskTolerance ? 1 : 0)) *
    (w.collapse_on_cluster || 1);

  scores.collect_xp =
    ((s.nearestPickupDist < 300 ? (300 - s.nearestPickupDist) / 100 : 0) +
    (s.nearEnemyCount < 3 ? 2 : 0) +
    (s.hpRatio > 0.4 ? 1 : 0)) *
    (w.collect_xp || 1);

  scores.boss_focus =
    ((s.bossPresent ? 5 : 0) +
    (s.hpRatio > 0.4 ? 1 : 0) +
    (s.bossPresent && s.bossDist < 400 ? 2 : 0)) *
    (w.boss_focus || 1);

  scores.maintain_pressure =
    ((s.hpRatio > 0.6 ? 2 : 0) +
    (s.nearestEnemyDist < s.weaponRange * 2 ? 1 : 0) +
    (s.weaponReady ? 1 : 0) +
    (s.encirclement < 0.5 ? 1 : 0)) *
    (w.maintain_pressure || 1);

  scores.hold_ground =
    ((s.nearestEnemyDist > s.preferredRange * 1.5 ? 2 : 0) +
    (!s.weaponReady ? 1 : 0) +
    (s.nearEnemyCount === 0 ? 2 : 0)) *
    (w.hold_ground || 1);

  return scores;
}

function scoreCandidates(sensor, intentionScores, weights) {
  const candidates = [];
  const dangerW = weights.dangerWeight || 1;
  const rewardW = weights.rewardWeight || 1;

  // 8 directional candidates
  for (let i = 0; i < 8; i++) {
    candidates.push({
      dx: sensor.dirX[i],
      dy: sensor.dirY[i],
      score: scoreSingleCandidate(
        sensor.dirX[i], sensor.dirY[i], i,
        sensor, intentionScores, dangerW, rewardW
      ),
      dirIndex: i,
    });
  }

  // Hold position
  candidates.push({
    dx: 0, dy: 0,
    score: scoreSingleCandidate(0, 0, -1, sensor, intentionScores, dangerW, rewardW),
    dirIndex: -1,
    label: 'hold',
  });

  // Orbit around nearest enemy
  if (sensor.nearestEnemyDist < 500) {
    const toEnemy = sensor.nearestEnemyAngle;
    const cwAngle = toEnemy + Math.PI / 2;
    const ccwAngle = toEnemy - Math.PI / 2;

    candidates.push({
      dx: Math.cos(cwAngle),
      dy: Math.sin(cwAngle),
      score: scoreSingleCandidate(
        Math.cos(cwAngle), Math.sin(cwAngle), -2,
        sensor, intentionScores, dangerW, rewardW
      ),
      dirIndex: -2,
      label: 'orbit_cw',
    });
    candidates.push({
      dx: Math.cos(ccwAngle),
      dy: Math.sin(ccwAngle),
      score: scoreSingleCandidate(
        Math.cos(ccwAngle), Math.sin(ccwAngle), -3,
        sensor, intentionScores, dangerW, rewardW
      ),
      dirIndex: -3,
      label: 'orbit_ccw',
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function scoreSingleCandidate(dx, dy, dirIdx, s, intents, dangerW, rewardW) {
  let score = 0;
  const isHold = dx === 0 && dy === 0;

  // Pre-computed danger/reward for directional candidates
  if (dirIdx >= 0 && dirIdx < 8) {
    score -= s.dirDanger[dirIdx] * dangerW;
    score += s.dirReward[dirIdx] * rewardW;
  }

  const hasEnemy = s.nearestEnemyDist < 500;
  let toEnemyX = 0, toEnemyY = 0;
  if (hasEnemy) {
    const eDist = s.nearestEnemyDist || 1;
    toEnemyX = (s.nearestEnemyX - s.playerX) / eDist;
    toEnemyY = (s.nearestEnemyY - s.playerY) / eDist;
  }

  // Flee fitness: move toward safest direction / away from enemies
  if (intents.flee > 0) {
    let fit;
    if (isHold) {
      fit = -1;
    } else {
      fit = dx * s.safestDirX + dy * s.safestDirY;
      if (hasEnemy && s.nearestEnemyDist < 200) {
        fit += (-(dx * toEnemyX + dy * toEnemyY)) * 0.5;
      }
    }
    score += fit * intents.flee;
  }

  // Kite fitness: perpendicular to enemy with slight retreat bias
  if (intents.kite > 0 && hasEnemy) {
    const perpX = -toEnemyY;
    const perpY = toEnemyX;
    const perpDot = Math.abs(dx * perpX + dy * perpY);
    const awayDot = -(dx * toEnemyX + dy * toEnemyY);
    score += (perpDot * 0.7 + awayDot * 0.3) * intents.kite;
  }

  // Hold range fitness: approach if far, retreat if close
  if (intents.hold_range > 0 && hasEnemy) {
    const rangeDelta = s.nearestEnemyDist - s.preferredRange;
    let fit;
    if (rangeDelta > 20) {
      fit = dx * toEnemyX + dy * toEnemyY;
    } else if (rangeDelta < -20) {
      fit = -(dx * toEnemyX + dy * toEnemyY);
    } else {
      const perpX = -toEnemyY;
      const perpY = toEnemyX;
      fit = isHold ? 0.5 : Math.abs(dx * perpX + dy * perpY) * 0.8;
    }
    score += fit * intents.hold_range;
  }

  // Reposition for shot: close range gap or maneuver for angle
  if (intents.reposition_for_shot > 0 && hasEnemy) {
    let fit;
    if (s.nearestEnemyDist > s.weaponRange) {
      fit = dx * toEnemyX + dy * toEnemyY;
    } else {
      fit = isHold ? 0.3 : 0.5;
    }
    score += fit * intents.reposition_for_shot;
  }

  // Collapse on cluster
  if (intents.collapse_on_cluster > 0) {
    const fit = dx * s.bestClusterDir.x + dy * s.bestClusterDir.y;
    score += Math.max(0, fit) * intents.collapse_on_cluster;
  }

  // Collect XP: move toward nearest pickup
  if (intents.collect_xp > 0 && s.nearestPickupDist < 300) {
    const pDist = s.nearestPickupDist || 1;
    const pDirX = (s.nearestPickupX - s.playerX) / pDist;
    const pDirY = (s.nearestPickupY - s.playerY) / pDist;
    const fit = dx * pDirX + dy * pDirY;
    score += Math.max(0, fit) * intents.collect_xp;
  }

  // Boss focus: move toward boss
  if (intents.boss_focus > 0 && s.bossPresent) {
    const bDist = s.bossDist || 1;
    const bDirX = (s.bossX - s.playerX) / bDist;
    const bDirY = (s.bossY - s.playerY) / bDist;
    score += (dx * bDirX + dy * bDirY) * intents.boss_focus;
  }

  // Maintain pressure: stay in combat range
  if (intents.maintain_pressure > 0 && hasEnemy) {
    const approach = dx * toEnemyX + dy * toEnemyY;
    score += (approach * 0.5 + (isHold ? 0.3 : 0)) * intents.maintain_pressure;
  }

  // Hold ground: prefer not moving
  if (intents.hold_ground > 0) {
    score += (isHold ? 1 : 0.2) * intents.hold_ground;
  }

  return score;
}
