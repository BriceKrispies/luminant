/**
 * Observation extraction layer.
 * Builds a compact, deterministic observation from engine state.
 * Policies consume this — never raw WASM memory.
 *
 * Observations are cheap to compute (one pass over nearby entities)
 * and contain all the signals a policy needs for decision-making.
 */

import { STATE } from '../engine/bindings.js';
import { WEAPON_DEFS } from '../content/weapon-types.js';

/** Number of directional sectors for density/threat analysis */
const NUM_SECTORS = 8;
const SECTOR_ANGLE = (Math.PI * 2) / NUM_SECTORS;

/** Query radii */
const NEAR_RADIUS = 150;
const MID_RADIUS = 350;
const FAR_RADIUS = 500;

/**
 * @typedef {Object} Observation
 * @property {number} playerX — world position
 * @property {number} playerY
 * @property {number} playerHP — current HP
 * @property {number} playerMaxHP
 * @property {number} hpRatio — 0-1
 * @property {number} level
 * @property {number} xp
 * @property {number} xpToNext
 * @property {number} xpRatio — 0-1 progress to next level
 * @property {string} weapon — current weapon id
 * @property {boolean} weaponReady — true if weapon cooldown has elapsed
 * @property {number} weaponCooldownRatio — 0 = ready, 1 = just fired
 * @property {number} weaponRange — effective range of current weapon in pixels
 * @property {number} enemiesInArc — enemies within weapon range and attack cone
 * @property {number} nearEnemyCount — enemies within NEAR_RADIUS
 * @property {number} midEnemyCount — enemies within MID_RADIUS
 * @property {number} farEnemyCount — enemies within FAR_RADIUS
 * @property {number[]} sectorDensity — enemy count per directional sector (8)
 * @property {number[]} sectorThreat — weighted threat per sector (hp*damage)
 * @property {number} nearestEnemyDist
 * @property {number} nearestEnemyAngle — radians
 * @property {number} nearestEnemyX
 * @property {number} nearestEnemyY
 * @property {number} nearestPickupDist
 * @property {number} nearestPickupAngle
 * @property {number} nearestPickupX
 * @property {number} nearestPickupY
 * @property {number} recentDamageTaken — HP lost since last observation
 * @property {number} gameTime — seconds since run start
 * @property {number} wave — current phase index
 * @property {number} totalKills
 * @property {number} totalEnemies — active enemy count
 * @property {number} worldW
 * @property {number} worldH
 * @property {number} distToEdge — min distance to any world boundary
 * @property {string[]} acquiredUpgrades — upgrade IDs picked so far
 * @property {string[]} activeEffects — behavioral effects active
 */

/**
 * Create an observation builder. Call build() each tick.
 * Tracks state across ticks for derived signals (recentDamageTaken).
 */
export function createObservationBuilder(engine) {
  let prevHP = -1;

  return {
    /**
     * Build observation from current engine state + game context.
     * @param {Object} ctx — { playerX, playerY, playerHP, playerMaxHP,
     *   level, xp, xpToNext, weapon, gameTime, wave, totalKills,
     *   acquiredUpgrades, activeEffects, worldW, worldH }
     */
    build(ctx) {
      const {
        playerX, playerY, playerHP, playerMaxHP,
        level, xp, xpToNext, weapon,
        weaponReady, weaponCooldownRatio,
        gameTime, wave, totalKills,
        acquiredUpgrades, activeEffects,
        worldW, worldH,
      } = ctx;

      // Track damage since last observation
      const recentDamageTaken = prevHP >= 0 ? Math.max(0, prevHP - playerHP) : 0;
      prevHP = playerHP;

      // Initialize sector arrays
      const sectorDensity = new Array(NUM_SECTORS).fill(0);
      const sectorThreat = new Array(NUM_SECTORS).fill(0);

      let nearEnemyCount = 0;
      let midEnemyCount = 0;
      let farEnemyCount = 0;

      let nearestEnemyDist = Infinity;
      let nearestEnemyAngle = 0;
      let nearestEnemyX = playerX;
      let nearestEnemyY = playerY;

      let nearestPickupDist = Infinity;
      let nearestPickupAngle = 0;
      let nearestPickupX = playerX;
      let nearestPickupY = playerY;

      let totalEnemies = 0;

      // Query all entities in FAR_RADIUS
      const nearby = engine.gridQuery(playerX, playerY, FAR_RADIUS);

      for (const id of nearby) {
        const type = engine.getEntityType(id);
        const state = engine.getEntityState(id);
        if (state !== STATE.ACTIVE) continue;

        const ex = engine.getEntityX(id);
        const ey = engine.getEntityY(id);
        const dx = ex - playerX;
        const dy = ey - playerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ang = Math.atan2(dy, dx);

        // Enemies (types 2-9)
        if (type >= 2 && type <= 9) {
          totalEnemies++;

          if (dist < NEAR_RADIUS) nearEnemyCount++;
          if (dist < MID_RADIUS) midEnemyCount++;
          farEnemyCount++;

          // Sector analysis
          let sectorIdx = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * NUM_SECTORS);
          if (sectorIdx >= NUM_SECTORS) sectorIdx = 0;
          sectorDensity[sectorIdx]++;
          const threat = engine.getEntityHP(id) * engine.getEntityDamage(id);
          sectorThreat[sectorIdx] += threat;

          if (dist < nearestEnemyDist) {
            nearestEnemyDist = dist;
            nearestEnemyAngle = ang;
            nearestEnemyX = ex;
            nearestEnemyY = ey;
          }
        }

        // Pickups (types 20+)
        if (type >= 20) {
          if (dist < nearestPickupDist) {
            nearestPickupDist = dist;
            nearestPickupAngle = ang;
            nearestPickupX = ex;
            nearestPickupY = ey;
          }
        }
      }

      // Weapon-aware attack signals
      const wepId = weapon || 'sword';
      const wepDef = WEAPON_DEFS[wepId] || WEAPON_DEFS.sword;
      // Effective range: melee uses range directly; projectiles use speed * lifetime
      const weaponRange = wepDef.range || (wepDef.projectileSpeed || 300) * (wepDef.lifetime || 1);
      const weaponConeHalf = (wepDef.coneAngle || Math.PI * 2) / 2; // full circle for projectiles

      // Count enemies that would actually be hit if we attacked toward nearestEnemy right now
      let enemiesInArc = 0;
      if (nearestEnemyDist < weaponRange * 1.2) {
        const aimAngle = nearestEnemyAngle;
        // Re-scan nearby for entities in the attack arc
        const arcQuery = engine.gridQuery(playerX, playerY, weaponRange);
        for (const id of arcQuery) {
          const type = engine.getEntityType(id);
          if (type < 2 || type > 9) continue;
          if (engine.getEntityState(id) !== STATE.ACTIVE) continue;
          const ex = engine.getEntityX(id);
          const ey = engine.getEntityY(id);
          const ang = Math.atan2(ey - playerY, ex - playerX);
          let diff = ang - aimAngle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          if (Math.abs(diff) <= weaponConeHalf) enemiesInArc++;
        }
      }

      // Distance to nearest world edge
      const distToEdge = Math.min(playerX, playerY, worldW - playerX, worldH - playerY);

      // Safest escape direction: the sector with the least threat,
      // biased toward sectors that also lead away from world edges.
      // This gives policies a stable flee vector that won't flip-flop
      // when surrounded — unlike nearest-enemy which changes every tick.
      let safestAngle = 0;
      let minThreat = Infinity;
      for (let i = 0; i < NUM_SECTORS; i++) {
        // Combine density and threat — an empty sector with no enemies is ideal
        const sectorScore = sectorThreat[i] + sectorDensity[i] * 10;
        const ang = ((i + 0.5) / NUM_SECTORS) * Math.PI * 2 - Math.PI;
        // Penalize directions that lead toward world edges
        const testX = playerX + Math.cos(ang) * 200;
        const testY = playerY + Math.sin(ang) * 200;
        const edgePenalty =
          (testX < 0 || testX > worldW || testY < 0 || testY > worldH) ? 1000 : 0;
        const total = sectorScore + edgePenalty;
        if (total < minThreat) {
          minThreat = total;
          safestAngle = ang;
        }
      }
      const safestDirX = Math.cos(safestAngle);
      const safestDirY = Math.sin(safestAngle);

      return {
        playerX, playerY,
        playerHP, playerMaxHP,
        hpRatio: playerMaxHP > 0 ? playerHP / playerMaxHP : 0,
        level,
        xp,
        xpToNext,
        xpRatio: xpToNext > 0 ? xp / xpToNext : 0,
        weapon: wepId,
        weaponReady: weaponReady !== undefined ? weaponReady : true,
        weaponCooldownRatio: weaponCooldownRatio || 0,
        weaponRange,
        enemiesInArc,
        nearEnemyCount,
        midEnemyCount,
        farEnemyCount,
        sectorDensity,
        sectorThreat,
        nearestEnemyDist: nearestEnemyDist === Infinity ? FAR_RADIUS : nearestEnemyDist,
        nearestEnemyAngle,
        nearestEnemyX,
        nearestEnemyY,
        nearestPickupDist: nearestPickupDist === Infinity ? FAR_RADIUS : nearestPickupDist,
        nearestPickupAngle,
        nearestPickupX,
        nearestPickupY,
        recentDamageTaken,
        gameTime: gameTime || 0,
        wave: wave || 0,
        totalKills: totalKills || 0,
        totalEnemies,
        worldW: worldW || 4096,
        worldH: worldH || 4096,
        distToEdge,
        safestDirX,
        safestDirY,
        acquiredUpgrades: acquiredUpgrades || [],
        activeEffects: activeEffects || [],
      };
    },

    reset() {
      prevHP = -1;
    },
  };
}
