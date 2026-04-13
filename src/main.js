/**
 * Main application entry point.
 * Wires together engine, systems, renderer, and UI.
 *
 * Boot flow:
 *   1. Load WASM, create renderer and input
 *   2. Show menu — wait for user action
 *   3. On "Start Game" or "Auto Mode": init engine, systems, start loop
 */

import { loadEngine } from './engine/loader.js';
import { EngineBindings, TYPE, STATE } from './engine/bindings.js';
import { createSnapshot } from './engine/snapshot.js';
import { createClock } from './systems/clock.js';
import { createInputSystem } from './systems/input.js';
import { createPlayerSystem } from './systems/player.js';
import { createSpawnerSystem } from './systems/spawner.js';
import { createDirectorSystem } from './systems/director.js';
import { createWeaponSystem } from './systems/weapons.js';
import { createXPSystem } from './systems/xp.js';
import { createSkillSystem } from './systems/skills.js';
import { createCameraSystem } from './systems/camera.js';
import { createCooldownSystem } from './systems/cooldowns.js';
import { createFeedbackSystem } from './systems/feedback.js';
import { createEliteSystem } from './systems/elite-system.js';
import { createAutoPlayerSystem } from './systems/auto-player.js';
import { createRendererManager } from './renderer/renderer-manager.js';
import { createDebugOverlay } from './renderer/debug-overlay.js';
import { addEffect, updateEffects, clearEffects } from './renderer/effects.js';
import { createLevelUpUI } from './ui/level-up.js';
import { createGameOverUI } from './ui/game-over.js';
import { createMenuUI } from './ui/menu.js';
import { createAppState, AppState } from './ui/state.js';
import { WEAPON_DEFS } from './content/weapon-types.js';
import { UPGRADE_POOL } from './content/upgrade-pool.js';

// Ensure built-in AI policies are registered (side-effect imports)
import './ai/policies/survival.js';
import './ai/policies/progression.js';

const WORLD_W = 4096;
const WORLD_H = 4096;

async function main() {
  // ── Register service worker for PWA / offline ──
  if ('serviceWorker' in navigator) {
    const swUrl = (import.meta.env?.BASE_URL || '/') + 'sw.js';
    navigator.serviceWorker.register(swUrl).then((reg) => {
      // Check for updates every 60s (catches deploys while tab is open)
      setInterval(() => reg.update().catch(() => {}), 60_000);

      // When a new SW is waiting, activate it and reload
      function onNewSW(sw) {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          // New version ready — reload to pick it up.
          // skipWaiting() in the SW triggers controllerchange below.
          sw.postMessage({ type: 'SKIP_WAITING' });
        }
      }
      if (reg.waiting) onNewSW(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        if (next) next.addEventListener('statechange', () => onNewSW(next));
      });
    }).catch(() => {});

    // Reload when a new SW takes control (seamless update)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  }

  // ── Step 1: Load core resources ──
  const canvas = document.getElementById('game-canvas');
  const wasm = await loadEngine();
  const engine = new EngineBindings(wasm);
  const input = createInputSystem(canvas);

  // ── Renderer manager (detects WebGPU, loads preference, inits renderer) ──
  const rendererBadge = document.getElementById('renderer-badge');
  const rendererManager = createRendererManager(canvas, {
    onSwitch(id, name) {
      if (rendererBadge) rendererBadge.textContent = name;
      console.log(`[main] Renderer active: ${name}`);
    },
    onError(id, message) {
      console.warn(`[main] Renderer error (${id}): ${message}`);
      // Show brief toast if user tried to switch to unsupported backend
      if (rendererBadge) {
        const prev = rendererBadge.textContent;
        rendererBadge.textContent = `${id}: not supported`;
        rendererBadge.classList.add('renderer-badge--error');
        setTimeout(() => {
          rendererBadge.textContent = prev;
          rendererBadge.classList.remove('renderer-badge--error');
        }, 2000);
      }
    },
  });
  await rendererManager.init();

  // Renderer toggle (keyboard shortcut: F4 or click badge)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F4') {
      e.preventDefault();
      rendererManager.toggle();
    }
  });
  if (rendererBadge) {
    rendererBadge.addEventListener('click', () => rendererManager.toggle());
  }

  // ── App state + menu ──
  const appState = createAppState();
  const menuUI = createMenuUI(document.getElementById('menu-layer'), appState);

  // ── Debug overlay (always available) ──
  const debugOverlay = createDebugOverlay(document.getElementById('debug-overlay'));
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
      e.preventDefault();
      debugOverlay.toggle();
    }
    if (e.code === 'Escape' && appState.screen === AppState.PLAYING) {
      appState.setScreen(AppState.PAUSED);
    }
  });

  // ── Systems (created once, reset per run) ──
  const clock = createClock(1 / 60);
  const player = createPlayerSystem(engine);
  const spawner = createSpawnerSystem(engine);
  const camera = createCameraSystem(
    canvas.getBoundingClientRect().width,
    canvas.getBoundingClientRect().height,
    WORLD_W, WORLD_H
  );
  const feedback = createFeedbackSystem(engine, { camera, clock });
  const weapons = createWeaponSystem(engine, { feedback });
  const xpSystem = createXPSystem(engine, { feedback });
  const skills = createSkillSystem(player, weapons);
  const cooldowns = createCooldownSystem();
  const elites = createEliteSystem(engine, spawner);
  const autoPlayer = createAutoPlayerSystem(engine);

  const levelUpUI = createLevelUpUI(document.getElementById('level-up-screen'));
  const gameOverUI = createGameOverUI(document.getElementById('game-over-screen'));

  let director = null;
  let playing = false;
  let gameOver = false;
  let adrenalineActive = false;

  const timings = {
    stepMs: 0, gridMs: 0, playerMs: 0, enemiesMs: 0,
    projMs: 0, collisionMs: 0, deathsMs: 0, renderMs: 0,
  };

  // ── Step 2: Menu — wait for user to start ──
  menuUI.onStart((mode, policyId) => {
    startGame(policyId);
  });

  // ── Game-over restarts via menu ──
  const autoUpgradesEl = document.getElementById('auto-upgrades');

  function returnToMenu() {
    playing = false;
    gameOver = false;
    autoPlayer.enabled = false;
    input.setOverride(null);
    autoUpgradesEl.classList.add('hidden');
    autoUpgradesEl.innerHTML = '';
    appState.setScreen(AppState.MENU);
  }

  function startGame(policyId) {
    gameOver = false;
    playing = true;
    adrenalineActive = false;

    engine.init(WORLD_W, WORLD_H);
    player.reset();
    weapons.reset();
    feedback.reset();
    xpSystem.reset();
    skills.reset();
    cooldowns.reset();
    elites.reset();
    clearEffects();

    player.spawn(WORLD_W / 2, WORLD_H / 2);
    director = createDirectorSystem(engine, spawner);
    clock.start();

    autoPlayer.enabled = true;
    autoPlayer.setPolicy(policyId || 'survival');
    autoPlayer.reset();
    input.setOverride(null);
    autoUpgradesEl.classList.remove('hidden');
    autoUpgradesEl.innerHTML = '';

    appState.setScreen(AppState.PLAYING);
  }

  // ── Step 3: Main loop (always runs for rendering, simulation only when playing) ──
  function loop(nowMs) {
    requestAnimationFrame(loop);

    if (!playing || gameOver) return;
    if (appState.screen === AppState.PAUSED) return;
    if (levelUpUI.active) return;

    const steps = clock.update(nowMs);

    for (const dt of steps) {
      // Auto-player: compute AI input and inject as override
      if (autoPlayer.enabled) {
        const pp = player.getPosition();
        // Feed game context for observation building
        autoPlayer.setContext({
          playerHP: player.getHP(),
          playerMaxHP: player.getMaxHP(),
          level: xpSystem.level,
          xp: xpSystem.xp,
          xpToNext: xpSystem.xpToNext,
          weapon: weapons.currentWeapon,
          weaponReady: weapons.ready,
          weaponCooldownRatio: weapons.cooldownRatio,
          gameTime: clock.totalTime,
          wave: director ? director.waveIndex : 0,
          totalKills: director ? director.totalKills : 0,
          acquiredUpgrades: skills.acquired,
          activeEffects: [...skills.activeEffects],
          worldW: WORLD_W,
          worldH: WORLD_H,
        });
        const aiInput = autoPlayer.update(pp.x, pp.y);
        if (aiInput) {
          // Convert AI world-space target to screen-space for the weapon system
          const screenTarget = camera.worldToScreen(aiInput.targetX, aiInput.targetY);
          input.setOverride({
            dx: aiInput.dx,
            dy: aiInput.dy,
            attack: aiInput.attack,
            targetX: screenTarget.x,
            targetY: screenTarget.y,
          });
        }
      }

      // Input → engine
      player.applyInput(input);
      const move = input.getMovement();
      const isMoving = Math.abs(move.dx) > 0.1 || Math.abs(move.dy) > 0.1;

      // Weapon aim target in world coords
      const worldTarget = camera.screenToWorld(input.mouseX, input.mouseY);
      const pp = player.getPosition();

      skills.updateStillTimer(dt, isMoving);

      // Step engine
      const t0 = performance.now();
      engine.step(dt);
      timings.stepMs = performance.now() - t0;

      // Weapon system
      const atkFlag = engine.getAttackFlag();
      weapons.update(dt, pp.x, pp.y, worldTarget.x, worldTarget.y, atkFlag, skills);
      engine.clearAttackFlag();

      // Thorns
      if (skills.hasEffect('thorns')) {
        const hp = player.getHP();
        const prevHp = cooldowns.getEffect('prevHp');
        if (prevHp !== null && hp < prevHp) {
          const nearby = engine.gridQuery(pp.x, pp.y, 80);
          for (const id of nearby) {
            const t = engine.getEntityType(id);
            if (t >= 2 && t <= 9 && engine.getEntityState(id) === 1) {
              engine.applyDamage(id, skills.stats.thornsDamage);
            }
          }
          feedback.emit({ type: 'hit', x: pp.x, y: pp.y, magnitude: skills.stats.thornsDamage });
        }
        cooldowns.addEffect('prevHp', dt + 0.02, hp);
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
      if (regenRate > 0) player.heal(regenRate * dt);

      cooldowns.update(dt);
      feedback.update(dt);
      updateEffects(dt);

      // Director + elites
      const enemyCount = engine.countByType(2, 9);
      director.update(dt, pp.x, pp.y, enemyCount);
      elites.update(dt, pp.x, pp.y, director.gameTime);

      // Camera
      camera.setTarget(pp.x, pp.y);
      camera.update(dt);

      // Level-up
      if (xpSystem.pendingLevelUps > 0) {
        const choices = skills.getUpgradeChoices(3);
        if (choices.length > 0) {
          xpSystem.consumeLevelUp();
          feedback.emit({ type: 'levelup', x: pp.x, y: pp.y });

          if (autoPlayer.enabled) {
            // Auto-pick via policy's upgrade strategy
            const chosenId = autoPlayer.chooseUpgrade(choices);
            const finalId = chosenId || choices[0].id;
            skills.applyUpgrade(finalId);

            // Show chosen upgrade on screen
            const upgDef = UPGRADE_POOL.find(u => u.id === finalId);
            if (upgDef) {
              const entry = document.createElement('div');
              entry.className = 'auto-upgrade-entry' +
                (upgDef.tier === 1 ? ' tier-1' : upgDef.tier === 2 ? ' tier-2' : '');
              entry.innerHTML = `<span class="upgrade-level">L${xpSystem.level}</span>${upgDef.name}`;
              autoUpgradesEl.appendChild(entry);
            }
          } else {
            levelUpUI.show(choices, (upgradeId) => {
              skills.applyUpgrade(upgradeId);
            });
          }
        }
      }

      // Death check
      if (!player.isAlive()) {
        playing = false;
        gameOver = true;
        gameOverUI.show({
          time: clock.totalTime,
          level: xpSystem.level,
          kills: director.totalKills,
          wave: director.waveIndex,
        }, returnToMenu);
      }
    }

    // Render
    if (steps.length > 0 || true) {
      const snapshot = createSnapshot(engine);
      const metrics = engine.getMetrics();

      const gameState = {
        playing,
        hp: player.getHP(),
        maxHp: player.getMaxHP(),
        xp: xpSystem.xp,
        xpToNext: xpSystem.xpToNext,
        level: xpSystem.level,
        kills: director ? director.totalKills : 0,
        wave: director ? director.waveIndex : 0,
        time: clock.totalTime,
        weaponName: WEAPON_DEFS[weapons.currentWeapon]?.name || '',
      };

      const t1 = performance.now();
      rendererManager.render(snapshot, camera, gameState);
      timings.renderMs = performance.now() - t1;

      debugOverlay.update({
        fps: clock.fps,
        activeEntities: snapshot.activeCount,
        enemyCount: snapshot.enemyCount,
        projectileCount: snapshot.projectileCount,
        pickupCount: snapshot.pickupCount,
        ...timings,
        collisionChecks: metrics.collisionChecks,
        damageEvents: metrics.damageEvents,
        killsThisFrame: metrics.kills,
        level: xpSystem.level,
        wave: director ? director.waveIndex : 0,
        totalKills: director ? director.totalKills : 0,
        time: clock.totalTime,
        phase: director ? director.waveIndex : 0,
        elites: elites.activeEliteCount,
        renderer: rendererManager.activeName,
        mode: 'auto',
        policyName: autoPlayer.policyName,
        autoAction: autoPlayer._lastAction,
      });
    }
  }

  // ── Resize ──
  window.addEventListener('resize', () => {
    rendererManager.resize();
    const c = rendererManager.canvas;
    camera.resize(
      c.getBoundingClientRect().width,
      c.getBoundingClientRect().height
    );
  });

  requestAnimationFrame(loop);
}

main().catch(console.error);
