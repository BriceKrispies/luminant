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
import { createEnemyActionsSystem } from './systems/enemy-actions.js';
import { createPlayerAISystem } from './systems/player-ai-system.js';
import { createRendererManager } from './renderer/renderer-manager.js';
import { createDebugOverlay } from './renderer/debug-overlay.js';
import { addEffect, updateEffects, clearEffects } from './renderer/effects.js';
import { createGameOverUI } from './ui/game-over.js';
import { createMenuUI } from './ui/menu.js';
import { createUpgradePicker } from './ui/upgrade-picker.js';
import { createArchetypePicker } from './ui/archetype-picker.js';
import { createHUD } from './ui/hud.js';
import { createAppState, AppState } from './ui/state.js';
import { WEAPON_DEFS } from './content/weapon-types.js';
import { UPGRADE_POOL } from './content/upgrade-pool.js';
import { createDecisionManager } from './decisions/manager.js';
import { DecisionKind, DecisionMode } from './decisions/types.js';
import { ARCHETYPES, DEFAULT_ARCHETYPE_ID } from './content/archetypes.js';
import { getLoadedWeightsMeta } from './ai/neural/neural-policy.js';

// Utility-based policies are registered via player-ai-system.js imports.
// Legacy policies (survival, progression) are also imported there.

const WORLD_W = 540;
const WORLD_H = 540;

async function main() {
  // ── Register service worker for PWA / offline ──
  if ('serviceWorker' in navigator) {
    const swUrl = (import.meta.env?.BASE_URL || '/') + 'sw.js';
    const banner = document.getElementById('update-banner');
    const bannerBtn = document.getElementById('update-banner-btn');
    let waitingSW = null;

    function showUpdateBanner(sw) {
      waitingSW = sw;
      if (banner) banner.classList.remove('hidden');
    }

    if (bannerBtn) {
      bannerBtn.addEventListener('click', () => {
        if (waitingSW) {
          // Trigger skipWaiting in the SW; controllerchange below reloads.
          waitingSW.postMessage({ type: 'SKIP_WAITING' });
        } else {
          window.location.reload();
        }
      });
    }

    navigator.serviceWorker.register(swUrl).then((reg) => {
      // Check for updates every 60s (catches deploys while tab is open)
      setInterval(() => reg.update().catch(() => {}), 60_000);

      function trackWaiting(sw) {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          // New version is ready and a controller exists — this is an
          // update, not the first install. Prompt the user.
          showUpdateBanner(sw);
        }
      }

      if (reg.waiting) trackWaiting(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        if (next) next.addEventListener('statechange', () => trackWaiting(next));
      });
    }).catch(() => {});

    // Reload when a new SW takes control (fires after SKIP_WAITING).
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
  // The on-screen toggle is gone; F4 keeps it available for dev use.
  const rendererManager = createRendererManager(canvas, {
    onSwitch(id, name) {
      console.log(`[main] Renderer active: ${name}`);
    },
    onError(id, message) {
      console.warn(`[main] Renderer error (${id}): ${message}`);
    },
  });
  await rendererManager.init();

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F4') {
      e.preventDefault();
      rendererManager.toggle();
    }
  });

  // ── App state + menu ──
  const appState = createAppState();
  const menuUI = createMenuUI(document.getElementById('menu-layer'), appState);

  // ── Debug overlay (always available) ──
  const debugOverlay = createDebugOverlay(document.getElementById('debug-overlay'));
  const debugToggleBtn = document.getElementById('debug-toggle');
  const cacheResetBtn = document.getElementById('cache-reset');

  function setDebugOn(on) {
    if (on) {
      if (!debugOverlay.visible) debugOverlay.toggle();
      debugToggleBtn?.classList.add('active');
      cacheResetBtn?.classList.remove('hidden');
    } else {
      if (debugOverlay.visible) debugOverlay.toggle();
      debugToggleBtn?.classList.remove('active');
      cacheResetBtn?.classList.add('hidden');
    }
  }

  if (debugToggleBtn) {
    debugToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setDebugOn(!debugOverlay.visible);
    });
  }

  // Nuclear-option cache reset — works on mobile without DevTools.
  // Unregisters SW, clears all caches, hard reloads.
  if (cacheResetBtn) {
    cacheResetBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      cacheResetBtn.textContent = 'RESETTING…';
      cacheResetBtn.disabled = true;
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch (err) {
        console.warn('[reset] failed to clear caches', err);
      }
      // Reload bypassing browser HTTP cache too.
      window.location.reload();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
      e.preventDefault();
      setDebugOn(!debugOverlay.visible);
    }
    if (e.code === 'Escape' && appState.screen === AppState.PLAYING) {
      appState.setScreen(AppState.PAUSED);
    }
  });

  // ── Systems (created once, reset per run) ──
  const clock = createClock(1 / 60);
  const player = createPlayerSystem(engine);
  const spawner = createSpawnerSystem(engine);
  // Camera uses the renderer's low-res render dimensions so the view area
  // matches the pixel art resolution (entities appear larger and chunky).
  const r = rendererManager.renderer;
  const camW = (r && r.renderWidth) || canvas.getBoundingClientRect().width;
  const camH = (r && r.renderHeight) || canvas.getBoundingClientRect().height;
  const camera = createCameraSystem(camW, camH, WORLD_W, WORLD_H);
  const feedback = createFeedbackSystem(engine, { camera, clock });
  const weapons = createWeaponSystem(engine, { feedback });
  const xpSystem = createXPSystem(engine, { feedback });
  const skills = createSkillSystem(player, weapons);
  const cooldowns = createCooldownSystem();
  const elites = createEliteSystem(engine, spawner);
  const enemyActions = createEnemyActionsSystem(engine, spawner, player);
  const autoPlayer = createPlayerAISystem(engine);

  const gameOverUI = createGameOverUI(document.getElementById('game-over-screen'));
  const hud = createHUD(document.getElementById('hud'));

  let director = null;
  let playing = false;
  let gameOver = false;
  let adrenalineActive = false;
  let lastEnemyCount = 0;

  const timings = {
    stepMs: 0, gridMs: 0, playerMs: 0, enemiesMs: 0,
    projMs: 0, collisionMs: 0, deathsMs: 0, renderMs: 0,
  };

  // ── Step 2: Menu — wait for user to start ──
  menuUI.onStart(() => {
    startGame();
  });

  // ── Game-over restarts via menu ──
  const autoUpgradesEl = document.getElementById('auto-upgrades');

  const upgradePicker = createUpgradePicker(
    document.getElementById('upgrade-picker')
  );
  const archetypePicker = createArchetypePicker(
    document.getElementById('archetype-picker')
  );

  // Composite presenter — dispatches to the right picker by decision kind.
  // Keeps the manager API simple (one presenter slot) while allowing many UIs.
  const compositePresenter = {
    present(request, options, resolve) {
      if (request.kind === DecisionKind.ARCHETYPE) {
        archetypePicker.present(request, options, resolve);
      } else {
        upgradePicker.present(request, options, resolve);
      }
    },
    cancel() {
      archetypePicker.cancel();
      upgradePicker.cancel();
    },
  };

  // Decision manager — live mode. Presenter renders UI; manager owns queue
  // and deadline; timeout falls through to autoPlayer.chooseUpgrade (policy).
  let latestDecisionObs = null;
  const decisions = createDecisionManager({
    mode: DecisionMode.LIVE,
    policy: autoPlayer,
    presenter: compositePresenter,
    seed: 0,
    onObservation: () => latestDecisionObs,
  });

  function logUpgrade(upgradeId, level) {
    const upgDef = UPGRADE_POOL.find(u => u.id === upgradeId);
    if (upgDef && autoUpgradesEl) {
      const entry = document.createElement('div');
      entry.className = 'auto-upgrade-entry' +
        (upgDef.tier === 1 ? ' tier-1' : upgDef.tier === 2 ? ' tier-2' : '');
      entry.innerHTML = `<span class="upgrade-level">L${level}</span>${upgDef.name}`;
      autoUpgradesEl.appendChild(entry);
    }
  }

  function returnToMenu() {
    playing = false;
    gameOver = false;
    autoPlayer.enabled = false;
    input.setOverride(null);
    decisions.cancelAll();
    upgradePicker.reset();
    archetypePicker.reset();
    autoUpgradesEl.classList.add('hidden');
    autoUpgradesEl.innerHTML = '';
    hud.hide();
    appState.setScreen(AppState.MENU);
  }

  function startGame() {
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
    autoPlayer.setPolicy('neural');
    autoPlayer.reset();
    input.setOverride(null);
    decisions.cancelAll();
    upgradePicker.reset();
    archetypePicker.reset();
    autoUpgradesEl.classList.remove('hidden');
    autoUpgradesEl.innerHTML = '';

    hud.show();

    // Run-start archetype decision. Blocks simulation via decisions.blocking
    // until the player picks (or 10s deadline fires and policy auto-picks).
    appState.setScreen(AppState.ARCHETYPE_SELECT);
    decisions.request({
      kind: DecisionKind.ARCHETYPE,
      tick: 0,
      optionsFn: () => ARCHETYPES.map(a => ({
        id: a.id, label: a.name, meta: { desc: a.desc },
      })),
      context: { phase: 'run-start' },
      defaultChoiceId: DEFAULT_ARCHETYPE_ID,
      blocking: true,
      deadlineMs: 10000,
    }, (result) => {
      if (!result || !result.choiceId) return;
      skills.applyArchetype(result.choiceId);
      appState.setScreen(AppState.PLAYING);
    });
  }

  // ── Step 3: Main loop (always runs for rendering, simulation only when playing) ──
  function loop(nowMs) {
    requestAnimationFrame(loop);

    if (!playing || gameOver) return;
    if (appState.screen === AppState.PAUSED) return;

    const steps = clock.update(nowMs);

    // Advance decision timers even while blocking (so deadline fires).
    for (const dt of steps) decisions.tick(dt);

    // If a blocking decision is active (e.g. archetype select), skip the
    // simulation step — but continue to render so the overlay animates.
    if (decisions.blocking) return;

    for (const dt of steps) {
      // Auto-player: compute AI input and inject as override
      let aiWorldTarget = null;
      if (autoPlayer.enabled) {
        const pp = player.getPosition();

        // Find nearest elite/boss for AI context
        let bossPresent = false, bossX = 0, bossY = 0, bossDist = Infinity;
        for (const eliteId of elites._activeEliteIds()) {
          const ex = engine.getEntityX(eliteId);
          const ey = engine.getEntityY(eliteId);
          const ddx = ex - pp.x, ddy = ey - pp.y;
          const d = Math.sqrt(ddx * ddx + ddy * ddy);
          if (d < bossDist) {
            bossX = ex; bossY = ey; bossDist = d; bossPresent = true;
          }
        }

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
          bossPresent,
          bossX,
          bossY,
          bossDist,
        });
        const aiInput = autoPlayer.update(pp.x, pp.y);
        if (aiInput) {
          // AI aim is already in world space — bypass the camera round-trip.
          // worldToScreen + screenToWorld is NOT an exact inverse when the
          // camera is shaking or has a hit-impulse, which would add random
          // noise to the aim target during combat. Keep movement/attack in
          // the override (input system path), but remember the world-space
          // aim for weapon update below.
          aiWorldTarget = { x: aiInput.targetX, y: aiInput.targetY };
          input.setOverride({
            dx: aiInput.dx,
            dy: aiInput.dy,
            attack: aiInput.attack,
            targetX: 0,
            targetY: 0,
          });
        }
      }

      // Input → engine
      player.applyInput(input);
      const move = input.getMovement();
      const isMoving = Math.abs(move.dx) > 0.1 || Math.abs(move.dy) > 0.1;

      // Weapon aim target in world coords — AI supplies world coords directly;
      // human mouse is converted via the camera.
      const worldTarget = aiWorldTarget
        ? aiWorldTarget
        : camera.screenToWorld(input.mouseX, input.mouseY);
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

      // Director + elites — use a fresh enemy count each tick to match the
      // headless harness; the previous "use lastEnemyCount" optimization
      // introduced a 1-frame spawn-pacing lag that diverged from training.
      const enemyCount = engine.countByType(2, 9);
      director.update(dt, pp.x, pp.y, enemyCount);
      elites.update(dt, pp.x, pp.y, director.gameTime);
      enemyActions.update(dt);

      // Camera — static arena view, still updates shake/impulse
      camera.update(dt);

      // Level-up — enqueue decision requests. Options are rolled lazily so
      // each card row reflects the stats produced by earlier picks in queue.
      while (xpSystem.pendingLevelUps > 0) {
        xpSystem.consumeLevelUp();
        feedback.emit({ type: 'levelup', x: pp.x, y: pp.y });
        const levelForPick = xpSystem.level;
        decisions.request({
          kind: DecisionKind.UPGRADE,
          tick: Math.round(clock.totalTime * 60),
          optionsFn: () => {
            const choices = skills.getUpgradeChoices(3);
            // Preserve the full upgrade definition (weapon, effect,
            // damageMultiplier, maxHpBonus, armor, …) so policy.chooseUpgrade
            // can actually score them. Earlier versions stripped to
            // {id,label,meta}, which broke the scorer — every choice scored
            // 0 and the shuffled-first choice always won, i.e. upgrades
            // were effectively random in the live game.
            return choices.map(c => ({
              ...c,
              label: c.name,
              meta: { tier: c.tier, desc: c.desc },
            }));
          },
          context: { level: levelForPick },
          defaultChoiceId: null,
          deadlineMs: 5000,
        }, (result) => {
          if (!result || !result.choiceId) return;
          skills.applyUpgrade(result.choiceId);
          logUpgrade(result.choiceId, levelForPick);
        });
      }

      // Death check
      if (!player.isAlive()) {
        playing = false;
        gameOver = true;
        upgradePicker.reset();
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
      lastEnemyCount = snapshot.enemyCount;
      // Attach player level/XP to snapshot so renderer can drive progression visuals
      if (snapshot.player) {
        snapshot.player.level = xpSystem.level;
        snapshot.player.xpProgress = xpSystem.xpToNext > 0 ? xpSystem.xp / xpSystem.xpToNext : 0;
      }
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

      hud.update(gameState);

      const t1 = performance.now();
      rendererManager.render(snapshot, camera);
      timings.renderMs = performance.now() - t1;

      debugOverlay.update({
        fps: clock.fps,
        weightsMeta: getLoadedWeightsMeta(),
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
        aiDebug: autoPlayer.debugData,
      });
    }
  }

  // ── Resize ──
  window.addEventListener('resize', () => {
    rendererManager.resize();
    // Use render resolution for camera so view area matches pixel art scale
    const rr = rendererManager.renderer;
    if (rr && rr.renderWidth) {
      camera.resize(rr.renderWidth, rr.renderHeight);
    } else {
      const c = rendererManager.canvas;
      camera.resize(
        c.getBoundingClientRect().width,
        c.getBoundingClientRect().height
      );
    }
  });

  requestAnimationFrame(loop);
}

main().catch(console.error);
