export function createMovementPlanner(config = {}) {
  const commitmentTime = config.commitmentTime || 8;
  const smoothingRate = config.smoothingRate || 0.3;
  const intentionHysteresis = config.intentionHysteresis || 0.15;
  const attackEagerness = config.attackEagerness || 1.0;

  let commitTimer = 0;
  let currentIntention = 'hold_ground';
  let smoothDx = 0;
  let smoothDy = 0;

  return {
    get currentIntention() { return currentIntention; },

    reset() {
      commitTimer = 0;
      currentIntention = 'hold_ground';
      smoothDx = 0;
      smoothDy = 0;
    },

    plan(scorerResult, sensor) {
      const { intentionScores, bestIntention, candidates } = scorerResult;

      // Hysteresis: only switch intention if new one beats current by margin
      if (commitTimer > 0) {
        commitTimer--;
        const currentScore = intentionScores[currentIntention] || 0;
        const newScore = intentionScores[bestIntention] || 0;
        if (newScore > currentScore * (1 + intentionHysteresis)) {
          currentIntention = bestIntention;
          commitTimer = commitmentTime;
        }
      } else {
        if (bestIntention !== currentIntention) {
          currentIntention = bestIntention;
          commitTimer = commitmentTime;
        }
      }

      // Emergency override: flee always breaks commitment
      if (sensor.hpRatio < 0.2 &&
          intentionScores.flee > (intentionScores[currentIntention] || 0)) {
        currentIntention = 'flee';
        commitTimer = 0;
      }

      const best = candidates[0] || { dx: 0, dy: 0 };

      // Faster smoothing when fleeing
      const rate = currentIntention === 'flee' ? 0.6 : smoothingRate;
      smoothDx += (best.dx - smoothDx) * rate;
      smoothDy += (best.dy - smoothDy) * rate;

      // Normalize if > 1
      const len = Math.sqrt(smoothDx * smoothDx + smoothDy * smoothDy);
      let finalDx = smoothDx;
      let finalDy = smoothDy;
      if (len > 1) {
        finalDx /= len;
        finalDy /= len;
      }

      const shouldAttack = decideAttack(sensor, currentIntention, attackEagerness);

      // Choose aim target: boss if focusing, else nearest enemy
      let targetX = sensor.nearestEnemyX;
      let targetY = sensor.nearestEnemyY;
      if (currentIntention === 'boss_focus' && sensor.bossPresent) {
        targetX = sensor.bossX;
        targetY = sensor.bossY;
      }

      return {
        dx: finalDx,
        dy: finalDy,
        attack: shouldAttack,
        targetX,
        targetY,
        _intention: currentIntention,
        _intentionScores: intentionScores,
        _topCandidates: candidates.slice(0, 3),
        _danger: sensor.localThreat,
        _encirclement: sensor.encirclement,
        _preferredRange: sensor.preferredRange,
      };
    },
  };
}

function decideAttack(sensor, intention, eagerness) {
  if (intention === 'flee' && sensor.nearestEnemyDist > sensor.weaponRange * 0.8) {
    return false;
  }

  const inRange = sensor.nearestEnemyDist < sensor.weaponRange * 1.1;
  const hasTarget = sensor.enemiesInArc >= 1;
  const ready = sensor.weaponReady;
  const clusterOpportunity = sensor.enemiesInArc >= 3;

  if (ready && inRange && hasTarget) return true;
  if (clusterOpportunity && inRange && eagerness > 0.5) return true;

  return false;
}
