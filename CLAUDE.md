# Luminant

AI-driven top-down survival-action game with WAT/WASM engine core.
The game is auto-mode only — AI policies control the player, there is no manual play.

## Architecture

- **Engine**: Raw WAT → WASM (`engine/core.wat` → `public/core.wasm`)
- **Bindings**: JS bridge over WASM memory (`src/engine/`)
- **Systems**: Game logic in JS (`src/systems/`)
- **AI/Policy**: Policy-driven auto mode + observations + scoring (`src/ai/`)
- **Player AI**: Layered utility-based AI system (`src/systems/player-ai/`) — sensors, utility scorer, movement planner, upgrade strategy
- **Renderer**: Dual-backend with manager (`src/renderer/`) — WebGPU default, Canvas 2D fallback
- **Creatures**: Pixel-art creature rendering (`src/renderer/creatures/`) — archetypes, world-space pixel drawing, deformations, visual progression
- **Skeletal Animation**: Custom 2D skeletal interpolation + skinned-mesh animation engine (`src/animation/`) — skeleton, pose, clip, sampler, blend, constraints, IK, mesh skinning, rig controller, runtime
- **Content**: Data definitions (`src/content/`), rigged character data (`src/content/rigs/`, `src/content/animations/`)
- **UI**: Menu, DOM HUD, level-up, game-over, upgrade picker, archetype picker (`src/ui/`)
- **Decisions**: Headless-first decision layer for archetype / upgrade / future shop-event picks (`src/decisions/`) — shared between live game and headless harness
- **Harnesses**: Headless, benchmark, batch sim, evolution (`harness/`)
- **Simulation Lab**: Offline bot experimentation, reward shaping, lineage tracking, replay, upgrade analytics (`src/lab/`, `harness/simulation-lab.js`, `debug/simulation-lab.html`)
- **Experiment Lab**: Structured experiment/training architecture — featurizer, moments, trajectories, evolutionary training, population analysis (`src/lab/`, `harness/experiment.js`, `debug/experiment-lab.html`)
- **Studio**: Offline creature preview/render tool (`studio/`) — browser-based rig inspector + Node.js PNG export + level progression preview with debug panel
- **Lab Page**: Live simulation gallery frontend (`lab/`) — deployed alongside the game, shows AI games running in real-time with per-tile stats. Modular panel architecture for future features.

Engine owns entity data. Renderer reads snapshots. JS handles game rules.

See `docs/architecture.md` for full layout.

## Module Boundaries

| Layer | Reads | Writes | Never touches |
|-------|-------|--------|---------------|
| WAT Engine | Entity memory, input globals | Entity memory, metrics | DOM, canvas, game rules |
| Engine Bindings | WASM memory | WASM memory (via exports) | DOM, canvas |
| Game Systems | Engine bindings | Engine bindings | Canvas, DOM (except UI) |
| Renderer | Snapshots, camera | Canvas pixels | Engine memory |
| Decisions | Policy, injected presenter | Decision history, choiceId | Engine memory, DOM, Canvas |
| Simulation Lab | Game-runner results, artifacts | JSON artifacts, analytics | Engine memory, DOM, Canvas |

## WAT ↔ JS Interface

JS calls WASM exports: `init`, `step`, `spawn_entity`, `despawn_entity`, `set_player_input`, `grid_query`, etc.
JS reads entity data directly from `memory.buffer` using typed array views.
Entity stride = 64 bytes. Field offsets defined in `src/engine/bindings.js`.
Entity types: 1=player, 2-13=enemies, 14-17=projectiles, 20+=pickups.
Entity states: 0=free, 1=active, 2=dying.
Snapshot includes `facing` field (radians) for directional creature rendering.

**Enemy behaviors** — 10 distinct steering behaviors in WAT `$update_enemies`, dispatched on the low 4 bits of the flags field (+56) which carries the `behavior_id`. Behavior state reuses per-enemy offsets: +52 `behavior_phase` (f32), +56 `behavior_flags` (i32: id/sub-phase/action bits), +60 `action_cd` (f32). Behaviors: 0=pursuer, 1=shooter, 2=orbiter, 3=kiter, 4=charger (windup→dash→recover), 5=flanker (uses player velocity), 6=zigzag (triangle-wave perpendicular), 7=ambusher (hidden→dash→pursue), 8=retreater (flees when HP < 50%), 9=summoner (kites + spawns minions via JS). Shooter/summoner set action flags; `src/systems/enemy-actions.js` polls each tick and spawns projectiles (PROJECTILE_ENEMY=17) or calls `spawner.spawnOne`. Enemy projectile→player collision handled in JS. See `src/content/enemy-types.js` for ENEMY_DEFS registry (each key maps to a `type` + `behaviorId`).

## Renderer

Dual-backend system with runtime switching:
- **WebGPU** (`webgpu-renderer.js`): Instanced entity rendering, WGSL shaders, orthographic projection. Creatures and effects drawn via low-res (540p) Canvas 2D overlay with nearest-neighbor upscaling.
- **Canvas 2D** (`canvas-renderer.js`): Renders to a fixed 540p low-res offscreen canvas, then blits up to display with nearest-neighbor scaling for a pixel-art look. Layered drawing (ground, lights, entities, effects, fog). Integer camera snapping prevents sub-pixel anti-aliasing.
- **Manager** (`renderer-manager.js`): Detects WebGPU, loads/saves preference to localStorage, handles runtime toggle (F4 / badge click). Replaces the canvas element on context switch since a canvas can only have one context type.
- **Interface** (`renderer-interface.js`): Contract — `{ id, name, init(), resize(), render(snapshot, camera), dispose() }`.
- **Creatures** (`creatures/`): Skeleton-based procedural creature rendering subsystem with layered rigging pipeline:
  - `skeleton.js` — Bone hierarchy + flat Float64Array poses (POSE_STRIDE=5), world transform solver
  - `animation.js` — Clip/track/keyframe system with easing, additive/multiplicative composition
  - `anim-controller.js` — State machine (idle/locomotion/attack/hit_react/dying), crossfade, one-shot interrupts
  - `slots.js` — Slot/attachment system with draw ordering, skin/expression/temp overrides, deformation extension seam
  - `overlays.js` — Additive overlays (breathing, hover bob, recoil, tension, head look, weapon follow)
  - `secondaries.js` — Per-archetype procedural motion (ghost drift, ember flicker, brute settle, slime bounce)
  - `expression.js` — Face expressions with blending, auto-blink, pupil bias
  - `skins.js` — Skin/variant separation (palette, slots, clips, profiles)
  - `rig-data.js` — Complete rig data for all 5 archetypes including player (skeletons, slots, clips, expressions, overlays)
  - `archetypes.js` — Visual definitions with rig references, entity type mapping, seeded PRNG
  - `deformations.js` — Legacy deformation layers (wobble, breathing, squash-stretch, hit, death), still used for body shape wobble
  - `creature-model.js` — Resolver with skeleton-based primary path and legacy fallback
  - `draw-pixel.js` — World-space pixel drawing: per-archetype pixel functions (player, slime, ghost, brute, ember), 1 world unit = 1 render pixel. Draws progression effects (glow behind body, tendrils/halo/burst above). Used by both backends.
  - `progression.js` — Data-driven visual progression state: derives tier, bounded intensity, modulation phase, unlocked features, and per-feature params from entity level/time/seed. Asymptotic intensity curve (never unbounded). Player config with 9 milestones (1-50). Per-archetype config registry with default fallback.
  - `progression-visuals.js` — Progression effect drawing: radial body glow, animated energy tendrils, halo/crown rings, level-up burst particles. All pixel-art scale. Per-feature toggle support for studio.
  - Both backends draw creatures via Canvas 2D at 540p low resolution (WebGPU uses a low-res offscreen canvas blitted to its overlay)

## Skeletal Animation Engine (`src/animation/`)

Custom 2D skeletal interpolation and skinned-mesh animation system. Render-side only — reads entity snapshots, never mutates simulation state.

**Core modules:**
- `skeleton.js` — Bone hierarchy, slots, mesh attachments. Bones: name, parentIndex, length, localBind{Position,Rotation,Scale}. Topological ordering enforced.
- `pose.js` — Flat Float64Array poses (STRIDE=5: tx, ty, rot, sx, sy). Functions: resetToBindPose, copyPose, computeWorldPose, applyDelta, get/setBoneLocal.
- `clip.js` — Animation clip format: tracks keyed to bone names, channels for tx/ty/rot/sx/sy with keyframes.
- `sampler.js` — Clip evaluation at time t. Lerp for translation/scale, shortest-path angle lerp for rotation. Loop/clamp support.
- `blend.js` — Pose blending: weighted 2-pose blend, additive layers, masked blending by bone set.
- `constraints.js` — Aim/look constraint, trail constraint (cloth/hair lag). Run after clips/blending, before skinning.
- `ik.js` — 2-bone IK solver for arms. Law of cosines + elbow-to-target approach.
- `mesh.js` — SkinnedMesh with bind vertices, triangle indices, per-vertex bone weights (up to 4 influences).
- `skinning.js` — CPU mesh skinning: weighted transform of bind vertices by world pose bones.
- `rig-controller.js` — Maps entity state to animation params: state machine (spawn→idle→drift→chase→hit_react→death), crossfade, procedural overlays (hover, lean, recoil, drag).
- `runtime.js` — Orchestrates full pipeline: controller → sample clips → blend → additive → constraints/IK → world pose → skin meshes.

**Runtime order:** read entity → build params → sample clips → blend → additive layers → procedural overrides → constraints/IK → world pose → skin → render.

**First rig:** Ghost Witch (`src/content/rigs/ghost-witch-rig.js`) — 15 bones: root, torso, head, hair, 2×arm chain (upper/lower/hand), 5 robe/cloth bones. 7 skinned meshes. Clips: idle, drift, chase, attack_windup, attack_release, hit_react, death, spawn.

**Renderer integration:** `src/renderer/skinned-entities.js` — per-entity runtime cache, draws deformed mesh triangles. Currently used for ENEMY_FAST (ghost witch). Debug overlay shows bones, wireframe, IK targets, anim state.

| Layer | Reads | Writes | Never touches |
|-------|-------|--------|---------------|
| Animation | Entity snapshots, game time | Canvas pixels (via meshes) | Engine memory, DOM |

## Commands

```bash
npm run dev          # Start dev server (compiles WAT first)
npm run build        # Production build
npm test             # Run Vitest test suite
npm run benchmark    # Run benchmark harness (100/500/1000/2000 enemies)
npm run headless     # Run headless simulation (--enemies=N --ticks=N)
npm run sim          # Single headless AI game (--policy=survival --maxTicks=30000)
npm run batch        # Batch simulation (--runs=10 --policy=survival --seed=N)
npm run evolve       # Evolution search (--policy=survival --pop=8 --gens=5)
npm run train        # Neuroevolution training (--pop=50 --gens=100 --runs=3)
npm run build:wat    # Compile engine/core.wat → public/core.wasm
npm run studio       # Open creature studio in browser
npm run render       # Render creature PNGs via Node.js (uses canvas package)
npm run lab          # Simulation Lab batch (alias for lab:batch)
npm run lab:batch    # Lab batch simulation (--runs=N --bias=NAME --mutate)
npm run lab:evolve   # Lab evolutionary search (--pop=N --gens=N --bias=NAME)
npm run lab:replay   # Replay stored run (--artifact=PATH --forced)
npm run lab:analytics # Aggregate analytics from stored artifacts
npm run lab:ui       # Open Simulation Lab debug UI in browser
npm run experiment   # Run experiment (--name=NAME --pop=N --gens=N --runs=N)
npm run experiment:run      # Run experiment from config (--config=PATH)
npm run experiment:evaluate # Evaluate single config across seeds
npm run experiment:analyze  # Population analysis on experiment artifacts
npm run experiment:compare  # Compare generation winners
npm run experiment:ui       # Open Experiment Lab UI in browser
npm run lab:page     # Open /lab simulation gallery page in browser
```

## HUD

DOM-based HUD (`src/ui/hud.js`) — replaces the old in-canvas `ui-render.js`. Renders HP bar, XP bar, level, kills, wave, timer, and weapon name as styled HTML elements. Design tokens in `src/style.css` (`--hud-*`). The HUD is managed by `main.js` — `hud.update(gameState)` each frame, `hud.show()`/`hud.hide()` on game start/end. Renderers no longer receive `gameState` — their signature is `render(snapshot, camera)`.

## Key Invariants

1. Engine never reads DOM or canvas
2. Renderer never writes to engine memory
3. All entity access goes through EngineBindings
4. Fixed timestep (1/60s) — clock accumulates and dispatches
5. JS handles spawn/despawn decisions, WAT handles per-entity math
6. Entity types 2-9 steer toward player in WAT
7. Entity types 10-19 move by velocity and expire by lifetime in WAT
8. Deaths: WAT sets state=2, JS processes dying entities (XP, pickups)
9. A canvas element can only have one context type — renderer manager replaces it on switch
10. Elite system exposes `_activeEliteIds()` for AI boss-tracking context
11. Camera is a static arena-fit view (centered on world, zoomed to fit world bounds) — it does not follow the player. `fitWorld()` runs at init and on resize; `update()` drives only shake/impulse.
12. Decisions never block the headless tick loop — `requestSync` always returns within the same call. Only `live` mode defers, and the main loop gates itself on `decisions.blocking` so rendering continues while simulation pauses. `src/decisions/**` never imports from `src/engine/`, `src/renderer/`, or `src/ui/`.

## AI / Policy System

- **Auto-mode only** — AI neural policy controls the player, no manual play or policy selection in UI
- **Default policy: strategist** — utility policy with behavior-aware overrides (summoner/shooter priority re-aim when in range, charger dash evasion), set in `main.js` via `setPolicy('strategist')`. Outperforms brawler/neural at 30k-tick bench against the 10-behavior mix. See `src/systems/player-ai/policies/strategist.js`. Consumes `obs.nearestSummoner`, `obs.nearestShooter`, `obs.incomingDasher`, `obs.countByBehavior` exposed by `src/ai/observations.js`
- **Policy** produces actions (dx, dy, attack, target) from observations each tick
- **Observations** built from engine state: spatial sectors, threat density, safest escape vector (`safestDirX/Y`), weapon readiness (`weaponReady`, `weaponRange`, `enemiesInArc`)
- **Intelligent attacks** — policy only swings when enemies are in range and weapon is ready, not always-attack
- **Upgrade strategy** is separate from movement policy
- **Scoring** is centralized in `src/ai/scoring.js`
- **Evolution** tunes policy parameters via `src/ai/evolution.js`
- Other policies (survival, progression, coward, kiter, farmer) still exist for batch sim/evolve harnesses but are not used in-game
- Policy input flows through `input.setOverride()` → same `setPlayerInput()` path

| Layer | Reads | Writes | Never touches |
|-------|-------|--------|---------------|
| AI/Policy | Observations | Actions (dx,dy,attack) | Engine memory, DOM |

### Player AI Layers (`src/systems/player-ai/`)

1. **Sensors** — enriches observations with: encirclement, directional danger/reward, closing speed, weapon-aware preferred range, cluster detection
2. **Utility Scorer** — scores 9 intentions (flee, kite, hold_range, reposition_for_shot, collapse_on_cluster, collect_xp, boss_focus, maintain_pressure, hold_ground) and evaluates 11 candidate moves (8 directions + hold + orbit CW/CCW)
3. **Movement Planner** — hysteresis/commitment prevents jitter, exponential smoothing, flee overrides commitment
4. **Upgrade Strategy** — build-aware upgrade choice with weapon synergy scoring

New policies are weight profiles via `createUtilityPolicy()`. See `docs/extending.md` for how to add one.

Debug overlay (`F3`) shows AI state for whichever policy is active:
- **Neural**: behavioral classification (stuck/overwhelmed/cornered/kiting/diving/idle/active), stuck frame counter, raw network outputs, key sensor metrics (HP, encirclement, threat, nearest enemy, edge distance)
- **Utility**: current intention, danger/encirclement levels, intention scores, and top candidate moves

### Neural Policy (`src/ai/neural/`)

Neuroevolution-trained feedforward network as a drop-in policy replacement.

- **`feedforward.js`** — Pure JS `FeedforwardNetwork` class: arbitrary topology, ReLU hidden layers, raw output, flat weight get/set, JSON serialization
- **`encode.js`** — Encodes sensor-enriched observation into 53 normalized floats for network input
- **`neural-policy.js`** — Policy wrapper registered as `'neural'`. Uses sensors for observation enrichment, brawler's upgrade strategy for level-ups. Output mapping: tanh for dx/dy, sigmoid for attack, tanh*PI for aim offset
- **`trained-weights.json`** — Serialized best network from training (topology + flat weights + fitness history)
- **Training**: `npm run train` runs `harness/neuroevolve.js` with worker pool (`harness/neuro-worker.js`). Population-based search: gaussian mutation, no crossover, elite selection, periodic random injection. Checkpoints every 10 gens to `results/`.
- **`neural-diagnostics.js`** — Behavioral classifier: classifies each frame as stuck/overwhelmed/cornered/kiting/diving/idle/active from sensor data + network output. Tracks consecutive stuck frames. Exposes key input metrics for debug overlay.
- **Topology**: [53, 32, 16, 4] = 2,324 parameters. 53 inputs from sensor layer, 4 raw outputs mapped to actions.
- **Diagnostics**: Neural policy attaches `_neuralDebug` to actions (same pattern as utility's `_intention`). Debug overlay (F3) shows behavioral state, stuck counter, raw outputs, and key sensor metrics when neural policy is active.
- **In-game**: Neural is the default policy in `main.js`. Brawler and other utility policies remain available for batch sim/evolve harnesses.

## Decision System (`src/decisions/`)

Headless-first decision layer. Gameplay systems request a decision (archetype at run start, upgrade at level-up, future shop/event picks) without knowing whether the resolver is a live UI, a policy, or a recorded replay script.

**Modules:**
- `types.js` — `DecisionRequest { kind, tick, optionsFn (lazy), context, defaultChoiceId, blocking?, deadlineMs? }`, `DecisionResult { requestId, kind, tick, choiceId, optionIds, source }`, `DecisionKind` (`'archetype' | 'upgrade'`), `DecisionSource` (`'human' | 'policy' | 'default' | 'scripted'`), `DecisionMode` (`'policy' | 'live' | 'scripted'`), `makeRequestId(kind, seed, tick, counter)`.
- `manager.js` — `createDecisionManager({ mode, policy, presenter?, seed, history, script?, onDrift?, onObservation })`. Exposes `requestSync(req)`, `request(req, onResolved)`, `tick(dt)`, `cancelAll()`, `blocking`, `pending`, `history`.

**Modes:**
- **`policy`** (headless) — `requestSync` calls `policy.decide(req, obs)`, falling back to `policy.chooseUpgrade` compat shim for `kind==='upgrade'`, else `defaultChoiceId`. Synchronous, zero allocation beyond the result.
- **`live`** (browser) — `request` defers to injected presenter; queue + deadline owned by manager; timeout falls through to policy-mode resolution. No presenter → falls straight to policy.
- **`scripted`** (replay) — `requestSync` matches each request against the recorded `decisionHistory` by `requestId` + `optionIds`. On drift, logs once per (kind, reason) and falls through to policy.

**Lazy options (`optionsFn`):** Choices are rolled at *resolution* time, not at request creation. This fixes a latent same-tick-double-level-up bug where the second pick's choices would otherwise reflect stats *before* the first pick was applied.

**Request ids** are `${kind}:${seed}:${tick}:${counter}` — deterministic per seed+tick, counter increments within a tick. Replay drift detection uses the id plus the offered optionIds.

**Presenters** are thin DOM adapters with contract `{ present(req, options, resolve), cancel() }`. `src/ui/upgrade-picker.js` and `src/ui/archetype-picker.js` are the two live-mode presenters. `main.js` wires both through a small composite presenter that dispatches by `request.kind`.

**Archetype content** (`src/content/archetypes.js`) — 3 starting archetypes (warrior, ranger, mystic) that set starting weapon and stat modifiers. Applied by `skills.applyArchetype(id)` before the tick loop. Recorded as the first entry of every run's `decisionHistory`.

**Integration points:**
- `src/ai/game-runner.js` — constructs manager in `policy` mode (or `scripted` when `decisionScript` is supplied); calls `requestSync` pre-loop for archetype and inside the level-up check.
- `src/main.js` — constructs manager in `live` mode; gates the simulation loop on `decisions.blocking`; calls `decisions.tick(dt)` each frame; `decisions.cancelAll()` on return-to-menu.
- `src/lab/run-recorder.js` — records `decisionHistory` into the artifact alongside the legacy `upgradeChoices`.
- `src/lab/replay.js` — `replayWithForcedUpgrades` uses scripted mode; legacy artifacts without `decisionHistory` are synthesized from `upgradeChoices`.
- `AppState.ARCHETYPE_SELECT` — new app-state value; main loop skips simulation while active (archetype decision is blocking).

| Layer | Reads | Writes | Never touches |
|-------|-------|--------|---------------|
| Decisions | Policy interface, injected presenter, decision script | Decision history entries | Engine memory, renderer, DOM (presenters only) |

## Simulation Lab (`src/lab/`)

Offline bot experimentation subsystem. Sits around the existing headless simulation path — does not replace it. No DOM or Canvas dependency.

**Core modules:**
- `bot.js` — Configurable bot policies with 6 named bias presets (survival, xp_collection, keep_distance, aoe_opportunity, elite_targeting, low_hp_caution). Mutation for evolutionary search. Serializable configs.
- `rewards.js` — Structured per-component reward breakdown: survival, kills, elite kills, XP, damage penalty, wasted upgrades, crowd control, consistency. Separate from scoring.js.
- `run-recorder.js` — Compact run artifacts: runId, parentRunId, generation, seed, bot config, upgrade choices, events, snapshots, summary, reward breakdown. All JSON-serializable.
- `lineage.js` — Ancestry tree: parent/child tracking, generation filtering, best-per-generation, serialize/load.
- `replay.js` — Re-run from seed + bot config. Verification against original. Forced-upgrade replay. Side-by-side comparison.
- `analytics.js` — Aggregate upgrade analytics: best by reward, strongest first pick, pairings, by wave, by policy archetype, pick rate vs success, dead picks. JSON + text output.
- `lab-runner.js` — Orchestrator: single sim, batch, evolutionary modes. Wires recorder + rewards + lineage.

**Harness:** `harness/simulation-lab.js` — CLI with commands: `batch`, `evolve`, `replay`, `compare`, `analytics`. Output to `results/lab/`.

**Debug UI:** `debug/simulation-lab.html` — browser lab surface. Load JSONL artifacts, view summaries, rewards, lineage trees, analytics, comparisons. Isolated from main game.

**Determinism:** Seed-deterministic replay. Same seed + same bot config + same code → same result. Known gap: no code versioning between record and replay.

| Layer | Reads | Writes | Never touches |
|-------|-------|--------|---------------|
| Simulation Lab | Game-runner results, artifacts | JSON artifacts, analytics | Engine memory, DOM, Canvas |
| Lab Page | Engine bindings, game systems, snapshots | Canvas pixels, DOM | N/A |

## Lab Page (`lab/`)

Live simulation gallery frontend deployed alongside the game at `/lab/`. Runs multiple AI game instances in-browser with visual rendering.

**Structure:**
- `lab/index.html` — page entry (registered as Vite multi-page input)
- `lab/src/lab-app.js` — app shell with hash-based panel routing
- `lab/src/panels/gallery.js` — gallery panel wiring controls to grid
- `lab/src/components/sim-instance.js` — self-contained game (own WASM + systems + renderer + camera)
- `lab/src/components/sim-gallery.js` — shared rAF loop, grid manager, speed multiplier
- `lab/src/components/sim-controls.js` — add/clear/speed/policy controls
- `lab/src/styles/lab.css` — layered CSS (tokens → layout → components → panels)

**Key design:** Each SimInstance creates its own WASM engine via `loadEngine()`, its own game systems (player, spawner, director, weapons, xp, skills, cooldowns, elites), policy, Canvas 2D renderer, and camera. A single `requestAnimationFrame` loop in SimGallery ticks and renders all instances. Speed multiplier (1x/2x/4x/8x) runs additional fixed timesteps per frame.

**Extending:** New panels added by creating a module in `lab/src/panels/` that exports `{ id, label, create(container), destroy() }` and registering it in `lab/src/lab-app.js`.

## Experiment / Training Architecture (`src/lab/`)

Structured experiment and evolutionary training platform built on the Simulation Lab.

### Core Components

- **`featurizer.js`** — Normalized feature extraction from observations. Schema-versioned. Groups: health, enemies, sectorDensity, sectorThreat, spatial, dirDanger, dirReward, weapon, pickups, progression, clusters, boss, movement. Reuses Float64Array buffer.
- **`moments.js`** — Gameplay moment detection system. 9 built-in moments: aoe_setup_success, clutch_escape, overcommit_punished, elite_focus_success, pickup_greed_punished, kiting_success, pressure_survived, dead_upgrade_pick, synergy_completed. Cooldowns, weight overrides, pluggable registration.
- **`trajectory.js`** — Per-run trajectory recording. Detail levels: summary, moments, sampled, full. Records tick-indexed features, actions, moments, upgrades, periodic summaries. JSON-serializable.
- **`experiment.js`** — Experiment config schema, validation, generation/experiment artifact constructors, seed strategies (sequential/fixed/random).
- **`training.js`** — Evolutionary training backend. Population initialization, evaluation, elite selection + mutation, random injection, per-generation artifacts.
- **`experiment-runner.js`** — Top-level orchestrator wiring config → training → game-runner → artifacts. Also `evaluateConfig()` for one-off evaluation.
- **`population-analysis.js`** — Parameter-reward correlation (Pearson), moment correlation, upgrade correlation, candidate dominance across seeds, convergence/stagnation/overfit detection.

### Enhancements to Existing Lab

- **`rewards.js`** — Added `moments` reward component. `computeRewardBreakdown()` accepts optional `{ moments, momentRewardScale }`.
- **`replay.js`** — Added `compareParentChild()` (config diff) and `compareGenerationWinners()` (cross-generation trend).

### Harness & UI

- **`harness/experiment.js`** — CLI: run, evaluate, analyze, compare commands.
- **`debug/experiment-lab.html`** — Browser UI: overview, generations, candidates, moments, convergence, compare tabs. Load JSONL artifacts.

### Data Flow

```
1. Experiment config → training backend → population of bot configs
2. Per candidate: bot config → createBotPolicy → game-runner → result
3. Featurizer extracts normalized features, moments detected
4. Trajectory records obs/action/moment stream
5. Rewards computed (including moment component)
6. Population evaluated → generation artifact
7. Selection + mutation → next generation
8. After all generations: experiment summary + population analysis
```

| Layer | Reads | Writes | Never touches |
|-------|-------|--------|---------------|
| Experiment | Game-runner results, bot configs | JSON artifacts, analysis | Engine memory, DOM, Canvas |

## PWA / Service Worker

- Service worker (`public/sw.js`) uses build-hash cache busting (injected by Vite plugin at build time)
- Network-first for HTML, cache-first for hashed assets, stale-while-revalidate for WASM/icons
- Auto-updates: checks every 60s, `skipWaiting` + `controllerchange` triggers reload

## Extending Safely

- New enemy type: add to `content/enemy-types.js`, types 2-9 auto-handled by WAT; add visual archetype in `renderer/creatures/archetypes.js`; add skeleton, slots, clips, expression profile, overlay config in `rig-data.js`; register secondary in `secondaries.js`
- New creature archetype: add to `archetypes.js` with `skeletonId`/`secondaryId`/`expressionId`, add skeleton + slots + clips in `rig-data.js`, add pixel draw function in `draw-pixel.js`, add TYPE_TO_ARCHETYPE mapping
- New creature skin: create SkinDef, call `registerSkin()` in `skins.js` — can override palette, slots, clips, secondary/expression profiles
- New skinned rigged character: create rig in `content/rigs/`, clips in `content/animations/`, add entity type check in `skinned-entities.js`. See `docs/extending.md`.
- New animation clip: add to the character's clip file, reference bone names from the rig's skeleton
- New weapon: add to `content/weapon-types.js` + upgrade in `upgrade-pool.js`
- New system: create in `src/systems/`, wire in `src/main.js`
- New policy: create in `src/ai/policies/`, call `registerPolicy()`, see `docs/extending.md`
- New renderer backend: implement interface, register in manager, see `docs/extending.md`
- WAT changes: edit `engine/core.wat`, run `npm run build:wat`, run `npm test`
- New lab reward component: add weight + computation in `src/lab/rewards.js`
- New lab bias preset: add to `BIAS_PRESETS` in `src/lab/bot.js`
- New lab analytics metric: add function in `src/lab/analytics.js`, include in `analyzeUpgrades()` return
- New lab UI panel: add tab in `debug/simulation-lab.html`
- New experiment moment: add MomentDef to `MOMENT_DEFS` in `src/lab/moments.js` or use `registerMoment()`
- New experiment feature group: add to `FEATURE_GROUPS` in `src/lab/featurizer.js`, bump `FEATURE_SCHEMA_VERSION`
- New experiment UI panel: add tab in `debug/experiment-lab.html`
- New lab page panel: create module in `lab/src/panels/` with `{ id, label, create(container), destroy() }`, register in `lab/src/lab-app.js`
- New archetype progression: create config object based on `PLAYER_PROGRESSION`, call `registerProgressionConfig(archetypeId, config)` in `progression.js`. Preview in studio.
- New player archetype: add entry to `ARCHETYPES` in `src/content/archetypes.js` (id, name, desc, optional `weapon`, optional `stats: {maxHpBonus, speedBonus, armor, regenRate, pickupRadius}`). `skills.applyArchetype` and the archetype-picker pick it up automatically.
- New decision kind: add a constant to `DecisionKind` in `src/decisions/types.js`; have gameplay call `decisions.request(...)` / `.requestSync(...)` with the new `kind`; teach policies via optional `policy.decide(req, obs)`; in live mode extend the composite presenter in `main.js` to dispatch to a new presenter. Record automatically flows through `decisionHistory`.
- New decision presenter: module exporting `createXxxPicker(container)` that returns `{ present(request, options, resolve), cancel() }`. Wire into `main.js` composite presenter. Do NOT touch engine or renderer.
- See `docs/extending.md` for detailed instructions

## Test Coverage

Tests in `test/`: engine lifecycle, entity spawn/despawn, player movement,
enemy pursuit and separation, projectile collision, damage and death,
XP/leveling, weapon spawning, spawner placement, benchmark sanity,
simulation determinism, policy interface, observations, scoring,
upgrade strategies, batch harness output, evolution sanity,
renderer interface validation, WebGPU detection, preference persistence,
renderer manager lifecycle, player AI sensors, utility scoring,
movement planner anti-jitter, utility policy behavior (flee, XP collection,
spacing, weapon adaptation), upgrade strategy coherence,
creature archetypes, seeded variation determinism, animation state detection,
deformation composition, creature model resolver, fallback behavior,
skeleton hierarchy, pose operations (blend/add/copy/reset), world transform solver,
clip sampling (keyframes, easing, looping), animation controller (state transitions,
crossfade, one-shot priority), slot/attachment resolution (draw order, overrides,
deformable flag), overlay composition (breathing, hover, recoil), secondary motion
determinism, expression controller (blending, blink, pupil bias, detect), skin
resolution, rig data integrity (bone ordering, slot-bone refs, clip-bone refs),
integrated skeleton-based resolver pipeline.
Skeletal animation engine: bone world transform evaluation, rotation interpolation
across wraparound, 2-pose blending, masked blending, additive layers, 2-bone IK solver,
mesh skinning (single bone, multi-bone, with rotation), aim constraint, trail constraint,
rig controller state machine (spawn→idle→chase→hit→death), clip determinism,
ghost witch rig integrity (bone references, skinning output).
Neural network: feedforward weight count, get/set roundtrip, forward pass determinism,
ReLU hidden activation, JSON serialization, observation encoding (length, normalization,
buffer reuse, missing fields), neural policy interface (registration, act shape, custom weights,
diagnostic data attachment), neural diagnostics (all 7 behavioral classifications, stuck frame
counting/reset, priority ordering, movement magnitude, output shape).
Simulation Lab: bot config creation, bias presets, multiple bias layering, direct overrides,
policy creation from config, serialize/deserialize round-trip, mutation without parent corruption,
deterministic mutation via RNG, range clamping, reward breakdown structure and totals,
damage penalty sign, run recorder IDs/upgrades/events/serialization, lineage parent/child
tracking, ancestry chains, generation filtering, best-per-generation, serialize/load round-trip,
upgrade analytics (by reward, first pick, pairings, dead picks, formatting, empty report),
replay verification (match/diverge detection), run comparison, lab runner integration (single sim
artifact, batch artifacts + analytics, mutation variation, deterministic replay from seed).
Experiment Lab: featurizer schema version/count/labels/groups, normalized feature extraction,
buffer reuse, extractArray serialization, moment definitions/registry/detection, cooldown
enforcement, upgrade-aware moments (dead pick, synergy), weight overrides, moment reward
computation, moment summarization, custom moment registration, detector reset, trajectory
recording (summary/moments/sampled/full detail levels), upgrade recording, trajectory stats,
experiment config creation/validation, generation artifacts, experiment summaries, seed
strategies (sequential/fixed), training population initialization/diversity, elite selection +
mutation, population evaluation with mock, random injection, parameter-reward correlation,
moment-reward correlation, upgrade-reward correlation, candidate dominance analysis,
convergence/stagnation detection, full population analysis, parent-child comparison with config
diff, generation winner comparison, rewards with moments component and scale factor.
Visual Progression: tier computation at milestone boundaries and between milestones,
high-level cap, intensity asymptotic bounds (never exceeds max, approaches max for
extreme levels), feature unlock accumulation across tiers, modulation phase wrapping
(never unbounded), full state determinism for same inputs, level 1 minimal visuals,
level 10 glow+tendrils, level 30 halo+crown, level 50 all features, intensity/tendril/
glow/halo bounded at extreme levels, default config for non-player archetypes, XP
progress smoothing, seed variation, burst state lifecycle (trigger/progress/deactivate/
reset), config registry (player/default/custom), debug formatting.

## Maintenance Rule

After adding or updating any system in this repository, update this CLAUDE.md file to reflect the change. This includes new systems, modified behaviors, new content types, new policies, changed invariants, and updated module boundaries. CLAUDE.md is the authoritative quick-reference for the codebase — it must stay current.
