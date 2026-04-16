/**
 * SimInstance — a self-contained running game with visual output.
 *
 * Each instance owns its own WASM engine, all game systems, a policy,
 * a canvas, a renderer, and a camera. This is the visual equivalent
 * of the headless game-runner.
 */

import { loadEngine } from '../../../src/engine/loader.js';
import { EngineBindings } from '../../../src/engine/bindings.js';
import { createSnapshot } from '../../../src/engine/snapshot.js';
import { createPlayerSystem } from '../../../src/systems/player.js';
import { createSpawnerSystem } from '../../../src/systems/spawner.js';
import { createDirectorSystem } from '../../../src/systems/director.js';
import { createWeaponSystem } from '../../../src/systems/weapons.js';
import { createXPSystem } from '../../../src/systems/xp.js';
import { createSkillSystem } from '../../../src/systems/skills.js';
import { createCooldownSystem } from '../../../src/systems/cooldowns.js';
import { createEliteSystem } from '../../../src/systems/elite-system.js';
import { createObservationBuilder } from '../../../src/ai/observations.js';
import { createCanvasRenderer } from '../../../src/renderer/canvas-renderer.js';
import { createCameraSystem } from '../../../src/systems/camera.js';

// Register policies so createPolicy can find them
import '../../../src/systems/player-ai/policies/brawler.js';
import '../../../src/ai/neural/neural-policy.js';
import { createPolicy, listPolicies } from '../../../src/ai/policy-types.js';

const WORLD_W = 4096;
const WORLD_H = 4096;
const DT = 1 / 60;

const nullFeedback = { emit() {}, update() {}, reset() {} };

let nextId = 1;

/**
 * Create a new SimInstance.
 * @param {Object} config
 * @param {string} config.policyId — registered policy id
 * @param {Object} [config.policyParams] — override policy params
 * @param {number} [config.seed] — RNG seed
 * @returns {Promise<SimInstance>}
 */
export async function createSimInstance(config = {}) {
  const {
    policyId = 'brawler',
    policyParams = {},
    seed = Date.now() + nextId,
  } = config;

  const id = nextId++;

  // Load WASM — each instance gets its own memory
  const wasm = await loadEngine();
  const engine = new EngineBindings(wasm);
  engine.init(WORLD_W, WORLD_H);

  // Create all game systems
  const player = createPlayerSystem(engine);
  const spawner = createSpawnerSystem(engine);
  const weapons = createWeaponSystem(engine, { feedback: nullFeedback });
  const xpSystem = createXPSystem(engine, { feedback: nullFeedback });
  const skills = createSkillSystem(player, weapons);
  const cooldowns = createCooldownSystem();
  const elites = createEliteSystem(engine, spawner);
  const director = createDirectorSystem(engine, spawner);
  const obsBuilder = createObservationBuilder(engine);

  // Create policy
  const policy = createPolicy(policyId, policyParams);
  policy.reset();
  obsBuilder.reset();

  // Create canvas element
  const canvas = document.createElement('canvas');
  canvas.className = 'sim-tile__canvas';

  // Create renderer — camera is created after mount when canvas has real dimensions
  const renderer = createCanvasRenderer(canvas);
  await renderer.init();
  let camera = createCameraSystem(480, 270, WORLD_W, WORLD_H);

  // Spawn player
  player.spawn(WORLD_W / 2, WORLD_H / 2);

  // Seeded PRNG
  const rng = createRNG(seed);

  // State
  let alive = true;
  let gameTime = 0;
  let totalDamageTaken = 0;
  let prevHP = player.getMaxHP();
  let adrenalineActive = false;
  let tickCount = 0;
  let cachedEnemyCount = 0;

  function tick() {
    if (!alive) return;

    // Temporarily override Math.random for determinism
    const origRandom = Math.random;
    Math.random = rng.next;

    try {
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
        weaponReady: weapons.ready,
        weaponCooldownRatio: weapons.cooldownRatio,
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

      // Feed input
      engine.setPlayerInput(action.dx || 0, action.dy || 0, action.attack ? 1 : 0);

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
          for (const eid of nearby) {
            const t = engine.getEntityType(eid);
            if (t >= 2 && t <= 9 && engine.getEntityState(eid) === 1) {
              engine.applyDamage(eid, skills.stats.thornsDamage);
            }
          }
        }
        cooldowns.addEffect('prevHp', DT + 0.02, hp);
      }

      // Deaths -> XP
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

      // Director + elites — use cached count from last snapshot to avoid rescanning
      director.update(DT, pp.x, pp.y, cachedEnemyCount);
      elites.update(DT, pp.x, pp.y, director.gameTime);

      // Camera
      camera.setTarget(pp.x, pp.y);
      camera.update(DT);

      // Level-up
      if (xpSystem.pendingLevelUps > 0) {
        const choices = skills.getUpgradeChoices(3);
        if (choices.length > 0) {
          xpSystem.consumeLevelUp();
          const chosenId = policy.chooseUpgrade(choices, obs);
          const finalChoice = chosenId || choices[0].id;
          skills.applyUpgrade(finalChoice);
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
      tickCount++;
    } finally {
      Math.random = origRandom;
    }
  }

  function render() {
    const snapshot = createSnapshot(engine);
    cachedEnemyCount = snapshot.enemyCount;
    if (snapshot.player) {
      snapshot.player.level = xpSystem.level;
      snapshot.player.xpProgress = xpSystem.xpToNext > 0 ? xpSystem.xp / xpSystem.xpToNext : 0;
    }
    renderer.render(snapshot, camera);
  }

  function getState() {
    return {
      id,
      policyId,
      alive,
      gameTime,
      level: xpSystem.level,
      kills: director.totalKills,
      wave: director.waveIndex,
      hp: player.getHP(),
      maxHp: player.getMaxHP(),
      tickCount,
    };
  }

  function destroy() {
    renderer.dispose();
  }

  /** Call after canvas is in the DOM so renderer gets real dimensions */
  function mount() {
    renderer.resize();
    const camW = renderer.renderWidth || 480;
    const camH = renderer.renderHeight || 270;
    camera = createCameraSystem(camW, camH, WORLD_W, WORLD_H);
  }

  return {
    id,
    canvas,
    policyId,
    tick,
    render,
    mount,
    getState,
    destroy,
  };
}

/** Seeded PRNG (xoshiro128**) — matches game-runner.js */
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

export { listPolicies };
