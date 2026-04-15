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

### Renderer (`src/renderer/`)
- `renderer-interface.js` — backend contract (id, name, init, resize, render, dispose)
- `renderer-manager.js` — capability detection, preference persistence, runtime switching
- `canvas-renderer.js` — Canvas 2D backend (layered drawing)
- `webgpu-renderer.js` — WebGPU backend (instanced rendering, WGSL shaders)
- `renderer.js` — re-export shim for backward compatibility
- `ground.js` — tiled noise texture ground (Canvas 2D)
- `fog.js` — screen-space vignette
- `lights.js` — dynamic colored light pools
- `entities.js` — player, enemy, projectile, pickup rendering (Canvas 2D)
- `effects.js` — hit/death/levelup visual effects
- `ui-render.js` — in-canvas HUD (HP, XP, level, kills), shared by both backends
- `debug-overlay.js` — FPS/entity/timing debug display

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
- `rig-data.js` — Data definitions for all 4 archetypes: skeleton bone layouts,
  slot/attachment layouts, animation clips, expression profiles, overlay configs.

**Existing systems (preserved, used as fallback):**
- `archetypes.js` — Visual archetype definitions with rig reference fields
  (skeletonId, secondaryId, expressionId), entity type mapping, seeded PRNG.
- `deformations.js` — Legacy deformation layers (wobble, breathing, squash-stretch,
  hit, death). Still used by skeleton path for body shape wobble.
- `creature-model.js` — Resolver with dual pipeline: skeleton-based (primary) and
  legacy deformation-based (fallback). Caches per-entity rig runtime instances.
- `draw-canvas.js` — Canvas 2D drawing with skeleton-based slot/attachment path
  and legacy shape path. Used by both backends.

Entity type → archetype mapping: basic→slime, fast→ghost, tank→brute, ranged→ember.
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
