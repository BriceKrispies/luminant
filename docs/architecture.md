# Luminant — Architecture

## Overview

Luminant is a top-down survival-action game built with:
- **Engine core**: Raw WAT (WebAssembly Text) compiled to WASM
- **Orchestration**: Vanilla JavaScript (ES modules)
- **Rendering**: Dual-backend (WebGPU default, Canvas 2D fallback)
- **Tooling**: Vite + Vitest

## Module Boundaries

```
┌─────────────────────────────────────────────────────────┐
│                    Browser App Shell                     │
│  index.html + src/main.js + src/style.css               │
├─────────────┬───────────────┬───────────────────────────┤
│  Renderer   │  Game Systems │  Content/Data             │
│  (mgr+back) │  (JS logic)   │  (definitions)            │
├─────────────┤               ├───────────────────────────┤
│             │               │  AI / Policy Layer        │
│             │               │  Observations · Policies  │
│             │               │  Scoring · Evolution      │
│             │               ├───────────────────────────┤
│             │               │  Decisions (headless-ok)  │
│             │               │  Archetype · Upgrade · …  │
├─────────────┴───────┬───────┴───────────────────────────┤
│            Engine Bindings (JS ↔ WASM bridge)           │
├─────────────────────┴───────────────────────────────────┤
│              WAT Engine Core (core.wasm)                │
│     Entities · Spatial Grid · Movement · Collision      │
└─────────────────────────────────────────────────────────┘
```

## Layer Responsibilities

### WAT Engine (`engine/core.wat` → `public/core.wasm`)
- Owns all entity data in linear memory
- Runs spatial grid rebuild, entity movement, collision detection, damage
- Exports: `init`, `step`, `spawn_entity`, `despawn_entity`, `set_player_input`, `grid_query`
- Does NOT know about game rules, weapons, XP, waves, or rendering

### Engine Bindings (`src/engine/`)
- `loader.js` — loads WASM module (browser or Node)
- `bindings.js` — typed JS wrapper over WASM memory + exports
- `snapshot.js` — creates read-only entity snapshots for the renderer
- `commands.js` — command queue for input abstraction

### Game Systems (`src/systems/`)
- `clock.js` — fixed-timestep simulation loop
- `input.js` — keyboard/mouse → movement/attack state
- `player.js` — player entity lifecycle
- `spawner.js` — enemy spawn placement
- `director.js` — wave progression and spawn scheduling
- `weapons.js` — weapon types, cooldowns, projectile spawning
- `xp.js` — XP collection, leveling, death processing
- `skills.js` — upgrade/skill tree management
- `camera.js` — viewport tracking with smooth follow
- `cooldowns.js` — named timer and status effect tracking
- `stats.js` — stat resolution with modifiers

### Content (`src/content/`)
- `enemy-types.js` — enemy archetype definitions (basic, fast, tank, ranged)
- `weapon-types.js` — weapon definitions (pistol, shotgun, nova)
- `skill-tree.js` — skill tree structure
- `wave-definitions.js` — wave progression table
- `upgrade-pool.js` — level-up upgrade choices

### AI / Policy Layer (`src/ai/`)
- `policy-types.js` — policy interface, registry, factory
- `observations.js` — compact observation extraction from engine state
- `scoring.js` — centralized fitness/reward scoring for run evaluation
- `analysis.js` — strategy analysis and reporting (upgrade paths, weapon correlations)
- `evolution.js` — evolutionary parameter search over policy params
- `upgrade-strategies.js` — upgrade decision weights and scoring
- `game-runner.js` — headless full-game runner using real systems
- `policies/survival.js` — survival-focused heuristic policy (legacy)
- `policies/progression.js` — XP/progression-focused heuristic policy (legacy)

### Player AI System (`src/systems/player-ai/`)

Layered utility-based AI that acts as a synthetic player. Four layers:

1. **Sensors** (`sensors.js`) — enriches observations with derived signals:
   encirclement, directional danger/reward maps, closing speed, preferred range
   (weapon+build aware), cluster detection
2. **Utility Scorer** (`utility-scorer.js`) — scores intentions (flee, kite,
   hold_range, reposition_for_shot, collapse_on_cluster, collect_xp,
   boss_focus, maintain_pressure, hold_ground) and evaluates candidate moves
   (8 directions + hold + orbit CW/CCW) against weighted intention fitness
3. **Movement Planner** (`movement-planner.js`) — converts winning candidate
   into smooth input with hysteresis/commitment to prevent jitter
4. **Upgrade Strategy** (`upgrade-strategy.js`) — build-aware upgrade selection
   using weapon synergy and policy preference weights

Policies are weight profiles, not separate AI implementations:
- `policies/coward.js` — high flee/survival bias, retreats early
- `policies/kiter.js` — maintains preferred range, hit-and-run
- `policies/brawler.js` — high pressure/cluster bias, fights close
- `policies/farmer.js` — high XP/pickup greed, opportunistic

`create-utility-policy.js` is the shared factory that wires sensors → scorer → planner
for any weight profile. All utility policies register via the standard `registerPolicy()`
system and are selectable from the menu alongside legacy policies.

### Decision System (`src/decisions/`)

Headless-first decision layer shared by live game and headless harness. Gameplay
systems request a decision without knowing how it will be resolved.

- `types.js` — `DecisionRequest { kind, tick, optionsFn (lazy), context, defaultChoiceId, blocking?, deadlineMs? }`, `DecisionResult { requestId, kind, tick, choiceId, optionIds, source }`, `DecisionKind`, `DecisionSource`, `DecisionMode`, `makeRequestId(kind, seed, tick, counter)`. No DOM / engine / renderer imports.
- `manager.js` — `createDecisionManager({ mode, policy, presenter?, seed, history, script?, onDrift?, onObservation })`. API: `requestSync(req)`, `request(req, onResolved)`, `tick(dt)`, `cancelAll()`, `blocking`, `pending`, `history`.

Three modes:
- `policy` (headless) — `requestSync` dispatches to `policy.decide(req, obs)` then `policy.chooseUpgrade` compat shim then `defaultChoiceId`. Synchronous, zero-alloc in hot path.
- `live` (browser) — `request` defers to an injected presenter; manager owns queue and deadline. On timeout, falls through to policy resolution.
- `scripted` (replay) — matches requests against a recorded `decisionHistory` by `requestId` + `optionIds`. Drift → log once per class + fall through to policy.

Options are evaluated **lazily** (`optionsFn` is invoked at resolution time) so a queued decision reflects the stats produced by earlier decisions in the same tick.

Request ids are `${kind}:${seed}:${tick}:${counter}` — deterministic per seed + tick, counter increments within a tick.

Live-mode presenters (`src/ui/upgrade-picker.js`, `src/ui/archetype-picker.js`) implement `{ present(req, options, resolve), cancel() }`. `main.js` wires both through a small composite presenter that dispatches by `request.kind`.

**First new decision kind — player archetype.** `src/content/archetypes.js` defines run-start archetypes (warrior, ranger, mystic). `skills.applyArchetype(id)` applies starting weapon + stat modifiers and is called before the tick loop in both `game-runner.js` and `main.js`. `AppState.ARCHETYPE_SELECT` gates the main loop via `decisions.blocking` while the player picks.

### Renderer (`src/renderer/`)
- `renderer-interface.js` — backend contract (id, name, init, resize, render, dispose)
- `renderer-manager.js` — capability detection, preference persistence, runtime switching
- `canvas-renderer.js` — Canvas 2D backend. Renders to a fixed 270p low-res offscreen canvas, then blits up to display with nearest-neighbor scaling for pixel-art look. Integer camera snapping prevents sub-pixel anti-aliasing.
- `webgpu-renderer.js` — WebGPU backend (instanced rendering, WGSL shaders). Creatures and effects drawn via a separate 270p low-res Canvas 2D overlay with nearest-neighbor upscaling.
- `renderer.js` — re-export shim for backward compatibility
- `ground.js` — pixel-art tiled terrain (16x16 world-unit tiles with stone/dirt pattern, accent details)
- `fog.js` — screen-space vignette
- `lights.js` — dynamic colored light pools
- `entities.js` — player, enemy, projectile, pickup rendering (Canvas 2D)
- `effects.js` — hit/death/levelup visual effects
- `debug-overlay.js` — FPS/entity/timing debug display, AI diagnostics (neural behavioral state or utility intention)

### Procedural Creatures (`src/renderer/creatures/`)

Skeleton-based procedural creature rendering subsystem. Enemies are drawn as
animated organic creatures with layered rigging: skeleton → animation clips →
overlays → secondary motion → expression → slot/attachment rendering.

**Core rigging pipeline:**
- `skeleton.js` — Bone hierarchy and flat Float64Array pose runtime. World
  transform solver (single linear pass). POSE_STRIDE=5: x, y, rot, scaleX, scaleY.
- `animation.js` — Clip/track/keyframe system with easing. Translation/rotation
  additive, scale multiplicative around 1.0. Supports looping and one-shot clips.
- `anim-controller.js` — Animation state machine: idle, locomotion, attack,
  hit_react, dying. Crossfade blending, priority-based one-shot interrupts,
  auto-detection of base state from entity data.
- `slots.js` — Slot/attachment system with draw ordering and layered overrides
  (skin, expression, temporary). Deformation extension seam via `deformable`
  flag and `deformParams`.
- `overlays.js` — Additive animation overlays: breathing, hover bob, recoil,
  tension, head look, weapon follow-through. Managed via overlay stack.
- `secondaries.js` — Archetype-specific procedural motion: ghost (float drift,
  cloak lag, wisp drag), ember (flame flutter, flicker pulse, flare response),
  brute (heavy settle, shoulder mass lag), slime (springy bounce, head darts).
- `expression.js` — Face/expression subsystem: smooth blending, automatic blink,
  pupil bias. Expressions: neutral, angry, surprised, hurt, dead, focused.
- `skins.js` — Skin/variant separation: skeleton, palette, slot overrides,
  clip overrides, secondary/expression profile IDs.
- `rig-data.js` — Data definitions for all 5 archetypes (including player): skeleton bone layouts,
  slot/attachment layouts, animation clips, expression profiles, overlay configs.

**Existing systems (preserved, used as fallback):**
- `archetypes.js` — Visual archetype definitions with rig reference fields
  (skeletonId, secondaryId, expressionId), entity type mapping, seeded PRNG.
- `deformations.js` — Legacy deformation layers (wobble, breathing, squash-stretch,
  hit, death). Still used by skeleton path for body shape wobble.
- `creature-model.js` — Resolver with dual pipeline: skeleton-based (primary) and
  legacy deformation-based (fallback). Caches per-entity rig runtime instances.
- `draw-pixel.js` — World-space pixel drawing with per-archetype pixel functions
  (player, slime, ghost, brute, ember). 1 world unit = 1 render pixel. Used by both backends.
  Draws progression effects (glow, tendrils, halo, burst) via progression-visuals.js.

**Visual progression system:**
- `progression.js` — Data-driven progression state derivation from entity level, time,
  XP progress, and seeded variation. Finite milestone unlocks (glow, tendrils, halo,
  crown, ascended) plus infinite bounded modulation (pulse, phase, hue drift). Asymptotic
  intensity curve ensures visuals never grow unbounded. Per-archetype config registry
  with player-specific and default configs. Level-up burst state tracking.
- `progression-visuals.js` — Renderer-side progression effect drawing: radial body glow,
  animated energy tendrils, halo/crown rings, level-up burst particles. All pixel-art
  scale (1 world-unit pixels). Called by draw-pixel.js in two passes (glow behind body,
  rest above body). Supports per-feature toggle flags for studio use.

Entity type → archetype mapping: player→player, basic→slime, fast→ghost, tank→brute, ranged→ember.
Snapshot includes `facing` field for directional rendering.

### Skeletal Animation Engine (`src/animation/`)

Custom 2D skeletal interpolation and skinned-mesh animation system, entirely on the
render side. Reads entity snapshots, produces deformed mesh vertex data for Canvas 2D.

**Core pipeline modules:**
- `skeleton.js` — Bone hierarchy (topological), slots, mesh attachments
- `pose.js` — Flat Float64Array poses (stride=5: tx/ty/rot/sx/sy), world transform solver
- `clip.js` — Keyframed animation tracks per bone (tx/ty/rot/sx/sy channels)
- `sampler.js` — Clip evaluation with loop/clamp, shortest-path rotation lerp
- `blend.js` — Weighted 2-pose blend, additive layers, masked blending
- `constraints.js` — Aim/look constraint, trailing cloth constraint
- `ik.js` — 2-bone IK (law of cosines)
- `mesh.js` — Skinned mesh with up to 4 bone influences per vertex
- `skinning.js` — CPU vertex skinning (weighted bone transforms)
- `rig-controller.js` — State machine mapping entity state → clip selection + procedural params
- `runtime.js` — Full pipeline orchestrator per entity instance

**Content:**
- `content/rigs/ghost-witch-rig.js` — 15-bone rig, 7 meshes, robe trail chain
- `content/animations/ghost-witch-clips.js` — 8 clips (idle, drift, chase, attack, hit, death, spawn)

**Renderer integration:**
- `renderer/skinned-entities.js` — Per-entity runtime cache, draws deformed mesh triangles,
  debug overlay (bones, wireframe, IK targets, anim state label)

Currently applied to: ENEMY_FAST (ghost witch). Other enemy types use the creature system.

## Key Invariants

1. **Engine owns simulation state.** The renderer never writes to engine memory.
2. **Renderer consumes snapshots.** It reads a frozen copy of entity state each frame.
3. **Input is data.** Keyboard/mouse → input state → engine via `set_player_input()`.
4. **Fixed timestep.** The clock accumulates time and dispatches fixed-dt ticks.
5. **JS handles game rules.** Leveling, weapons, waves, and upgrades live in JS.
6. **WAT handles hot paths.** Entity movement, collision, and spatial queries are in WASM.

## Memory Layout (WASM)

| Region | Address Range | Size | Contents |
|--------|--------------|------|----------|
| Entities | `0x000000–0x03FFFF` | 256 KB | 4096 × 64B entity records |
| Grid cells | `0x040000–0x07FFFF` | 256 KB | 64×64 cells × 16 slots × 4B |
| Grid counts | `0x080000–0x083FFF` | 16 KB | 64×64 cell counts |
| Globals | `0x084000–0x0840FF` | 256B | Shared state (player_id, metrics) |
| Query buffer | `0x084100–0x0844FF` | 1 KB | grid_query results |
| Metrics | `0x084500–0x0845FF` | 256B | Per-frame counters |

## Entity Record (64 bytes)

| Offset | Field | Type | Description |
|--------|-------|------|-------------|
| +0 | x | f32 | World X position |
| +4 | y | f32 | World Y position |
| +8 | vx | f32 | Velocity X |
| +12 | vy | f32 | Velocity Y |
| +16 | hp | f32 | Current health |
| +20 | max_hp | f32 | Maximum health |
| +24 | type | i32 | Entity type enum |
| +28 | state | i32 | 0=free, 1=active, 2=dying |
| +32 | radius | f32 | Collision radius |
| +36 | damage | f32 | Contact/attack damage |
| +40 | speed | f32 | Movement speed |
| +44 | xp_value | f32 | XP awarded on kill |
| +48 | cooldown | f32 | Attack cooldown timer |
| +52 | facing | f32 | Facing angle (radians) |
| +56 | flags | i32 | Bitfield |
| +60 | lifetime | f32 | Remaining lifetime |

## Data Flow Per Frame

```
1. Input system reads keyboard/mouse (or policy produces action in auto mode)
2. Player controller converts to (dx, dy, attack)
3. engine.set_player_input(dx, dy, attack)
4. engine.step(dt)
   ├── rebuild_grid
   ├── update_player
   ├── update_enemies (pursuit + separation)
   ├── update_projectiles (movement + lifetime)
   ├── check_player_collisions (enemies + pickups)
   ├── check_projectile_collisions
   └── process_deaths
5. Weapon system checks attack flag → spawns projectiles
6. XP system processes dying entities → spawns pickups, awards XP
7. Director system spawns enemies based on wave table
8. Camera follows player
9. Snapshot created from engine memory
10. Renderer manager dispatches snapshot to active backend (WebGPU or Canvas 2D)
```

## Auto Mode / AI Data Flow

```
1. Observation builder extracts compact obs from engine state
2. Policy.act(obs) → { dx, dy, attack, targetX, targetY }
3. Action injected via input.setOverride() — same path as manual play
4. On level-up: policy.chooseUpgrade(choices, obs) → upgrade ID
```

Policies never touch engine memory directly. They consume observations
and produce actions that flow through the normal input pathway.

## Utility AI Pipeline (new-style policies)

```
1. Observation builder → obs
2. Sensors.sense(obs) → enriched sensor data (encirclement, dirDanger, etc.)
3. UtilityScorer.score(sensorData, weights) → intention scores + candidate scores
4. MovementPlanner.plan(scored, sensorData) → smoothed action with hysteresis
5. Action injected via input.setOverride() — same path as all input
```

Utility policies are weight profiles over this shared pipeline. Adding a new
policy only requires defining a new weight object — no new AI code needed.

## Simulation Lab (`src/lab/`)

Offline experimentation subsystem for bot testing, reward analysis, and
evolutionary search. Sits around the existing headless simulation path —
does not replace it.

### Module Boundaries

```
┌───────────────────────────────────────────────┐
│              Simulation Lab                    │
│  lab-runner · analytics · lineage · replay    │
├───────────────────────────────────────────────┤
│  Bot Config / Rewards / Run Recorder          │
├───────────────────────────────────────────────┤
│          Game Runner (ai/game-runner.js)       │
├───────────────────────────────────────────────┤
│  Existing Systems (director, weapons, XP...)  │
├───────────────────────────────────────────────┤
│          Engine Bindings → WAT Engine          │
└───────────────────────────────────────────────┘
```

| Layer | Reads | Writes | Never touches |
|-------|-------|--------|---------------|
| Lab | Game-runner results, artifacts | JSON artifacts, analytics | Engine memory, DOM, Canvas |

### Components

- **`bot.js`** — Configurable bot policies with named bias presets (survival,
  XP collection, keep-distance, AOE opportunity, elite targeting, low-HP
  caution). Mutation support for evolutionary search. Serializable configs.
- **`rewards.js`** — Structured per-component reward breakdown: survival,
  kills, elite kills, XP, damage penalty, wasted upgrades, crowd control,
  consistency. Separate from scoring.js (which is a single fitness number).
- **`run-recorder.js`** — Produces compact run artifacts with full provenance:
  runId, parentRunId, generation, seed, bot config, upgrade choices, events,
  snapshots, summary, reward breakdown. All JSON-serializable.
- **`lineage.js`** — Ancestry tree for evolutionary experimentation. Tracks
  parent/child relationships, generation filtering, best-per-generation.
- **`replay.js`** — Re-runs recorded runs from seed + stored bot config.
  Verification against original. Side-by-side comparison. Forced-upgrade replay.
- **`analytics.js`** — Aggregate upgrade analytics across many runs: best by
  reward, strongest first pick, pairings, by wave, by policy, pick rate vs
  success rate, dead picks. JSON + human-readable output.
- **`lab-runner.js`** — Orchestrator: single sim, batch, and evolutionary modes.
  Wires recorder, rewards, and lineage together.

### Data Flow

```
1. Bot config (biases + weights) → createBotPolicy → utility policy
2. Lab runner wraps game-runner with recording + reward computation
3. Run artifact (JSON) emitted per simulation
4. Lineage tree tracks parent→child across evolutionary generations
5. Analytics aggregate across all artifacts
6. Replay re-runs from artifact's seed + bot config
```

### Harness / CLI

`harness/simulation-lab.js` — five commands: `batch`, `evolve`, `replay`,
`compare`, `analytics`. All output to `results/lab/`.

### Debug UI

`debug/simulation-lab.html` — browser-based lab surface. Load JSONL artifacts,
view run summaries, reward breakdowns, lineage trees, analytics tables,
side-by-side comparison. Isolated from the main game.

### Determinism

Replay is seed-deterministic: same seed + same bot config → same simulation.
Known gaps: no game-code versioning, potential floating-point micro-divergence
on long runs across platforms, code changes between record and replay will
cause divergence. Forced-upgrade replay is available for tighter reproduction.

## Experiment / Training Architecture (`src/lab/`)

Structured experimentation and evolutionary training platform built on top of
the Simulation Lab. Provides a complete pipeline from experiment configuration
through population-based evolutionary search to artifact analysis.

### Module Boundaries

```
┌─────────────────────────────────────────────────┐
│           Experiment Runner                      │
│  experiment-runner.js · experiment.js            │
├─────────────────────────────────────────────────┤
│  Training   │  Analysis    │  Trajectory/Moments │
│  training.js│  population- │  trajectory.js      │
│             │  analysis.js │  moments.js         │
│             │              │  featurizer.js      │
├─────────────┴──────────────┴─────────────────────┤
│         Simulation Lab (bot, rewards, lineage)    │
├───────────────────────────────────────────────────┤
│         Game Runner (ai/game-runner.js)           │
├───────────────────────────────────────────────────┤
│         Engine Bindings → WAT Engine              │
└───────────────────────────────────────────────────┘
```

| Layer | Reads | Writes | Never touches |
|-------|-------|--------|---------------|
| Experiment | Game-runner results, bot configs | JSON artifacts, analysis | Engine memory, DOM, Canvas |

### Components

- **`featurizer.js`** — Normalized observation-to-feature-vector extraction.
  Schema-versioned (bump on layout change). 13 feature groups covering health,
  enemies, sectors, spatial, directional danger/reward, weapon, pickups,
  progression, clusters, boss, movement. Reuses Float64Array buffer for
  zero-allocation per-tick extraction. `extractArray()` for JSON serialization.

- **`moments.js`** — Gameplay moment detection system. Data-driven definitions
  with id, name, tags, weight, cooldown, detector function. 9 built-in moments:
  aoe_setup_success, clutch_escape, overcommit_punished, elite_focus_success,
  pickup_greed_punished, kiting_success, pressure_survived, dead_upgrade_pick,
  synergy_completed. `registerMoment()` for custom additions. Detectors consume
  current + previous observation + context (upgrade notifications).

- **`trajectory.js`** — Per-run trajectory recording at configurable detail:
  summary (smallest), moments, sampled (at interval), full (every tick).
  Records features, actions, rewards, moments, upgrades, periodic summaries.
  `trajectoryStats()` computes reward curves, moment frequency, action
  distribution from finalized trajectories.

- **`experiment.js`** — Experiment configuration schema (versioned), validation,
  seed strategies (sequential, fixed, random). Constructors for generation
  artifacts and experiment summaries. All artifacts have type, version, metadata.

- **`training.js`** — Evolutionary training backend. Population initialization
  with diversity, candidate evaluation across seeds, truncation selection with
  elite carry-forward, mutation from elite parents, random injection to prevent
  premature convergence. `runGeneration()` produces generation artifacts with
  population statistics (mean, stddev, diversity).

- **`experiment-runner.js`** — Top-level orchestrator: `runExperiment()` wires
  config → population init → generation loop → selection → artifacts.
  Progress callbacks for generation and run events. `evaluateConfig()` for
  quick single-config evaluation across seeds.

- **`population-analysis.js`** — Statistical analysis suite:
  - Parameter-reward Pearson correlation
  - Moment frequency correlation with reward
  - Upgrade path correlation with success
  - Candidate dominance across seeds
  - Convergence/stagnation/overfit/collapse detection via linear regression
  - `fullPopulationAnalysis()` aggregates all analyses

### Enhancements to Existing Lab

- **`rewards.js`** — Added `moments` reward component (9th). `computeRewardBreakdown()`
  accepts optional `{ moments, momentRewardScale }` for moment-driven reward shaping.
- **`replay.js`** — Added `compareParentChild()` with config weight diffs and
  `compareGenerationWinners()` for cross-generation trend analysis.

### Data Flow

```
1. Experiment config defines: policy family, base params, reward/moment profile,
   seed strategy, training params (pop size, generations, elites, mutation)
2. Population initialized from base config with diversity
3. Per generation:
   a. Each candidate evaluated across N seeds
   b. Per run: bot config → policy → game-runner → result
   c. Featurizer extracts features, moments detected, trajectory recorded
   d. Rewards computed (base components + moment component)
   e. Candidates ranked by average reward
   f. Generation artifact emitted
4. Selection: elites carry forward, rest mutated from elites + random injection
5. After all generations: experiment summary + population analysis
```

### Harness / CLI

`harness/experiment.js` — four commands: `run`, `evaluate`, `analyze`, `compare`.
Output to `artifacts/`. Supports JSON config files via `--config=PATH`.

### Experiment UI

`debug/experiment-lab.html` — browser-based experiment surface. Six tabs:
Overview (experiment summary + reward curve chart), Generations (candidate
ranking table + population stats), Candidates (weight profile of best),
Moments (frequency table), Convergence (trend analysis + generation history),
Compare (generation winner progression). Load experiment artifacts via
file drop or file picker.

### Artifact Types

| Type | File Pattern | Contents |
|------|-------------|----------|
| `experiment_config` | `*-config.json` | Experiment parameters, reward/moment profile |
| `generation` | `*-generations.jsonl` | Per-generation candidate rankings, population stats |
| `experiment` | `*-summary.json` | Full experiment summary, reward curve, best candidate |
| `run` | `*-runs.jsonl` | Individual run artifacts (from run-recorder) |
| `trajectory` | embedded in runs | Observation/action/moment stream at detail level |

### Future-Proofing

The architecture accommodates future policy backends (imitation learning,
value estimators, model-based) through:
- Stable feature schema with versioning (featurizer)
- Clean policy interface (act/chooseUpgrade from observations)
- JSON-serializable trajectories for offline training
- Pluggable moment system for reward signal customization
- Experiment config extensible for new training backend types
