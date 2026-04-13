/**
 * Observation extraction layer.
 * Builds a compact, deterministic observation from engine state.
 * Policies consume this — never raw WASM memory.
 *
 * Observations are cheap to compute (one pass over nearby entities)
 * and contain all the signals a policy needs for decision-making.
 */

import { STATE } from '../engine/bindings.js';

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
 * @property {number} cooldownReady — 1 if weapon ready, 0 if on cooldown (approximated)
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

      // Distance to nearest world edge
      const distToEdge = Math.min(playerX, playerY, worldW - playerX, worldH - playerY);

      return {
        playerX, playerY,
        playerHP, playerMaxHP,
        hpRatio: playerMaxHP > 0 ? playerHP / playerMaxHP : 0,
        level,
        xp,
        xpToNext,
        xpRatio: xpToNext > 0 ? xp / xpToNext : 0,
        weapon: weapon || 'sword',
        cooldownReady: 1, // approximation; actual cooldown is in weapon system
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
        acquiredUpgrades: acquiredUpgrades || [],
        activeEffects: activeEffects || [],
      };
    },

    reset() {
      prevHP = -1;
    },
  };
}
