import { WEAPON_DEFS } from '../../content/weapon-types.js';

const NUM_DIRS = 8;
const DIR_ANGLES = Array.from({ length: NUM_DIRS }, (_, i) =>
  (i / NUM_DIRS) * Math.PI * 2 - Math.PI
);
const DIR_X = DIR_ANGLES.map(a => Math.cos(a));
const DIR_Y = DIR_ANGLES.map(a => Math.sin(a));

export function createSensors() {
  let prevEnemyDist = Infinity;

  return {
    reset() {
      prevEnemyDist = Infinity;
    },

    sense(obs) {
      const {
        sectorDensity, sectorThreat,
        nearEnemyCount, playerX, playerY, worldW, worldH,
      } = obs;

      // Encirclement: fraction of sectors with enemies
      let occupiedSectors = 0;
      for (let i = 0; i < NUM_DIRS; i++) {
        if (sectorDensity[i] > 0) occupiedSectors++;
      }
      const encirclement = occupiedSectors / NUM_DIRS;

      // Local threat: aggregate danger score
      let totalSectorThreat = 0;
      for (let i = 0; i < NUM_DIRS; i++) {
        totalSectorThreat += sectorThreat[i];
      }
      const localThreat =
        totalSectorThreat / Math.max(obs.nearestEnemyDist, 1) * 0.01 +
        nearEnemyCount * 0.2;

      // Closing speed estimate
      const closingSpeed = prevEnemyDist - obs.nearestEnemyDist;
      prevEnemyDist = obs.nearestEnemyDist;

      // Preferred range from weapon + build
      const preferredRange = computePreferredRange(obs);

      // Directional danger and reward scores
      const dirDanger = new Array(NUM_DIRS);
      const dirReward = new Array(NUM_DIRS);

      for (let i = 0; i < NUM_DIRS; i++) {
        const testX = playerX + DIR_X[i] * 200;
        const testY = playerY + DIR_Y[i] * 200;
        const edgeRisk =
          (testX < 50 || testX > worldW - 50 ||
           testY < 50 || testY > worldH - 50) ? 5 : 0;

        const prev = (i + NUM_DIRS - 1) % NUM_DIRS;
        const next = (i + 1) % NUM_DIRS;
        const adjacentThreat = (sectorThreat[prev] + sectorThreat[next]) * 0.3;

        dirDanger[i] =
          sectorThreat[i] + sectorDensity[i] * 10 + adjacentThreat + edgeRisk;

        // Reward: pickup proximity in this direction
        let pickupReward = 0;
        if (obs.nearestPickupDist < 300) {
          const pickupAngle = obs.nearestPickupAngle;
          let angleDiff = pickupAngle - DIR_ANGLES[i];
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          if (Math.abs(angleDiff) < Math.PI / 3) {
            pickupReward = (300 - obs.nearestPickupDist) / 300 * 3;
          }
        }

        const clusterReward = sectorDensity[i] >= 3 ? sectorDensity[i] * 0.5 : 0;
        dirReward[i] = pickupReward + clusterReward;
      }

      // Best cluster direction
      let maxDensitySector = 0;
      let maxDensity = 0;
      for (let i = 0; i < NUM_DIRS; i++) {
        if (sectorDensity[i] > maxDensity) {
          maxDensity = sectorDensity[i];
          maxDensitySector = i;
        }
      }

      // Clustered sector count (sectors with 2+ enemies)
      let clusteredSectors = 0;
      for (let i = 0; i < NUM_DIRS; i++) {
        if (sectorDensity[i] >= 2) clusteredSectors++;
      }

      return {
        ...obs,
        encirclement,
        localThreat,
        closingSpeed,
        preferredRange,
        dirDanger,
        dirReward,
        clusteredSectors,
        bestClusterDir: {
          x: DIR_X[maxDensitySector],
          y: DIR_Y[maxDensitySector],
        },
        bossPresent: obs.bossPresent || false,
        bossX: obs.bossX || 0,
        bossY: obs.bossY || 0,
        bossDist: obs.bossDist || Infinity,
        dirAngles: DIR_ANGLES,
        dirX: DIR_X,
        dirY: DIR_Y,
      };
    },
  };
}

function computePreferredRange(obs) {
  const wepDef = WEAPON_DEFS[obs.weapon] || WEAPON_DEFS.sword;
  let base;

  if (wepDef.pattern === 'cone') {
    base = wepDef.range * 0.85;
  } else if (wepDef.pattern === 'spread') {
    base = (wepDef.projectileSpeed * wepDef.lifetime) * 0.4;
  } else if (wepDef.pattern === 'burst') {
    base = (wepDef.projectileSpeed * wepDef.lifetime) * 0.35;
  } else {
    base = 100;
  }

  const hasSpeedBonus = (obs.activeEffects || []).includes('quick_dodge');
  const tankyCount = (obs.acquiredUpgrades || []).filter(id =>
    id === 'hp_1' || id === 'armor_thorns' || id === 'regen_1'
  ).length;
  const hasTankyBuild = tankyCount >= 2;

  if (hasSpeedBonus) base *= 1.15;
  if (hasTankyBuild) base *= 0.85;
  if (obs.hpRatio < 0.3) base *= 1.3;

  return base;
}

export { NUM_DIRS, DIR_ANGLES, DIR_X, DIR_Y };
