/**
 * Headless game runner.
 * Runs a complete game (director, weapons, XP, upgrades, elites)
 * headlessly with a policy controlling the player.
 *
 * Uses the same systems as the real game — not a simplified simulation.
 * No DOM, no canvas, no renderer.
 */

import { loadEngine } from '../engine/loader.js';
import { EngineBindings, TYPE, STATE } from '../engine/bindings.js';
import { createPlayerSystem } from '../systems/player.js';
import { createSpawnerSystem } from '../systems/spawner.js';
import { createDirectorSystem } from '../systems/director.js';
import { createWeaponSystem } from '../systems/weapons.js';
import { createXPSystem } from '../systems/xp.js';
import { createSkillSystem } from '../systems/skills.js';
import { createCooldownSystem } from '../systems/cooldowns.js';
import { createEliteSystem } from '../systems/elite-system.js';
import { createObservationBuilder } from './observations.js';
import { computeScore } from './scoring.js';

const WORLD_W = 4096;
const WORLD_H = 4096;
const DT = 1 / 60;

/**
 * Seeded PRNG (xoshiro128**).
 * Replaces Math.random for deterministic runs.
 */
function createRNG(seed) {
  let s = [seed, seed ^ 0xDEADBEEF, seed ^ 0x12345678, seed ^ 0xCAFEBABE];

  function next() {
    const result = (s[1] * 5) | 0;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = (s[3] << 11) | (s[3] >>> 21);
    return (result >>> 0) / 4294967296;
  }

  return { next };
}

/**
 * Run a single headless game with a policy.
 *
 * @param {Object} options
 * @param {PolicyInterface} options.policy — the policy controlling the player
 * @param {number} [options.seed] — RNG seed for determinism
 * @param {number} [options.maxTicks] — max simulation ticks (default: 30000 = ~8.3 min)
 * @param {Object} [options.wasm] — pre-loaded WASM exports (avoids reloading)
 * @param {boolean} [options.recordSnapshots] — record periodic snapshots
 * @param {number} [options.snapshotInterval] — ticks between snapshots (default: 300 = 5s)
 * @param {boolean} [options.silent] — suppress console output
 * @returns {Object} — structured run result
 */
export async function runGame(options) {
  const {
    policy,
    seed = Date.now(),
    maxTicks = 30000,
    wasm: preloadedWasm,
    recordSnapshots = false,
    snapshotInterval = 300,
    silent = true,
  } = options;

  // Seed Math.random replacement
  const rng = createRNG(seed);
  const origRandom = Math.random;
  Math.random = rng.next;

  try {
    const wasm = preloadedWasm || await loadEngine();
    const engine = new EngineBindings(wasm);

    engine.init(WORLD_W, WORLD_H);

    // Create systems — same as real game
    const player = createPlayerSystem(engine);
    const spawner = createSpawnerSystem(engine);
    const weapons = createWeaponSystem(engine, { feedback: nullFeedback });
    const xpSystem = createXPSystem(engine, { feedback: nullFeedback });
    const skills = createSkillSystem(player, weapons);
    const cooldowns = createCooldownSystem();
    const elites = createEliteSystem(engine, spawner);
    const director = createDirectorSystem(engine, spawner);
    const obsBuilder = createObservationBuilder(engine);

    // Spawn player
    player.spawn(WORLD_W / 2, WORLD_H / 2);

    // Reset policy
    policy.reset();
    obsBuilder.reset();

    // Tracking
    let gameTime = 0;
    let alive = true;
    let totalDamageTaken = 0;
    let prevHP = player.getMaxHP();
    let adrenalineActive = false;
    const upgradeHistory = [];
    const snapshots = [];

    for (let tick = 0; tick < maxTicks; tick++) {
      if (!alive) break;

      const pp = player.getPosition();

      // Build observation
      const obs = obsBuilder.build({
        playerX: pp.x,
        playerY: pp.y,
        playerHP: player.getHP(),
        playerMaxHP: player.getMaxHP(),
        level: xpSystem.level,
        xp: xpSystem.xp,
        xpToNext: xpSystem.xpToNext,
        weapon: weapons.currentWeapon,
        gameTime,
        wave: director.waveIndex,
        totalKills: director.totalKills,
        acquiredUpgrades: skills.acquired,
        activeEffects: [...skills.activeEffects],
        worldW: WORLD_W,
        worldH: WORLD_H,
      });

      // Policy decision
      const action = policy.act(obs);

      // Feed input to engine (same path as manual play)
      engine.setPlayerInput(action.dx || 0, action.dy || 0, action.attack ? 1 : 0);

      // Weapon system — compute world-space aim
      const isMoving = Math.abs(action.dx) > 0.1 || Math.abs(action.dy) > 0.1;
      skills.updateStillTimer(DT, isMoving);

      // Step engine
      engine.step(DT);

      // Weapon system
      const atkFlag = engine.getAttackFlag();
      weapons.update(DT, pp.x, pp.y, action.targetX || pp.x, action.targetY || pp.y, atkFlag, skills);
      engine.clearAttackFlag();

      // Thorns
      if (skills.hasEffect('thorns')) {
        const hp = player.getHP();
        const prevHpVal = cooldowns.getEffect('prevHp');
        if (prevHpVal !== null && hp < prevHpVal) {
          const nearby = engine.gridQuery(pp.x, pp.y, 80);
          for (const id of nearby) {
            const t = engine.getEntityType(id);
            if (t >= 2 && t <= 9 && engine.getEntityState(id) === 1) {
              engine.applyDamage(id, skills.stats.thornsDamage);
            }
          }
        }
        cooldowns.addEffect('prevHp', DT + 0.02, hp);
      }

      // Deaths → XP
      xpSystem.processDyingEntities(skills, player);

      // Adrenaline
      if (skills.hasEffect('speed_on_kill')) {
        const frameKills = engine.getKills();
        if (frameKills > 0) {
          if (!cooldowns.hasEffect('adrenaline')) {
            player.modifySpeed(54);
          }
          cooldowns.addEffect('adrenaline', 2, {});
        } else if (!cooldowns.hasEffect('adrenaline') && adrenalineActive) {
          player.modifySpeed(-54);
          adrenalineActive = false;
        }
        if (cooldowns.hasEffect('adrenaline')) {
          adrenalineActive = true;
        }
      }

      // Regen
      let regenRate = skills.stats.regenRate;
      if (skills.hasEffect('scaling_regen')) {
        regenRate += Math.max(0, xpSystem.level - 1) * 0.5;
      }
      if (regenRate > 0) player.heal(regenRate * DT);

      cooldowns.update(DT);

      // Director + elites
      const enemyCount = engine.countByType(2, 9);
      director.update(DT, pp.x, pp.y, enemyCount);
      elites.update(DT, pp.x, pp.y, director.gameTime);

      // Level-up
      if (xpSystem.pendingLevelUps > 0) {
        const choices = skills.getUpgradeChoices(3);
        if (choices.length > 0) {
          xpSystem.consumeLevelUp();
          const chosenId = policy.chooseUpgrade(choices, obs);
          const finalChoice = chosenId || choices[0].id;
          skills.applyUpgrade(finalChoice);
          upgradeHistory.push({
            tick,
            level: xpSystem.level,
            chosen: finalChoice,
            options: choices.map(c => c.id),
          });
        }
      }

      // Track damage
      const currentHP = player.getHP();
      if (currentHP < prevHP) {
        totalDamageTaken += prevHP - currentHP;
      }
      prevHP = currentHP;

      // Death check
      if (!player.isAlive()) {
        alive = false;
      }

      gameTime += DT;

      // Record snapshots
      if (recordSnapshots && tick % snapshotInterval === 0) {
        snapshots.push({
          tick,
          time: gameTime,
          hp: player.getHP(),
          maxHp: player.getMaxHP(),
          level: xpSystem.level,
          kills: director.totalKills,
          wave: director.waveIndex,
          enemies: enemyCount,
          xp: xpSystem.totalXPEarned,
        });
      }

      if (!silent && tick % 1800 === 0) {
        console.log(`  [${gameTime.toFixed(0)}s] L${xpSystem.level} K${director.totalKills} W${director.waveIndex} HP${Math.round(player.getHP())}/${Math.round(player.getMaxHP())}`);
      }
    }

    const result = {
      seed,
      policyId: policy.id,
      policyName: policy.name,
      policyParams: policy.params ? { ...policy.params } : {},
      survivalTime: gameTime,
      level: xpSystem.level,
      kills: director.totalKills,
      totalXP: xpSystem.totalXPEarned,
      wave: director.waveIndex,
      damageTaken: totalDamageTaken,
      survived: alive,
      upgradePath: upgradeHistory.map(h => h.chosen),
      upgradeHistory,
      weaponPath: skills.acquired.filter(id =>
        ['sword_mastery', 'shotgun_unlock', 'nova_unlock'].includes(id)
      ),
      snapshots: recordSnapshots ? snapshots : undefined,
    };

    result.score = computeScore(result);

    return result;

  } finally {
    Math.random = origRandom;
  }
}

/** No-op feedback for headless mode */
const nullFeedback = {
  emit() {},
  update() {},
  reset() {},
};
