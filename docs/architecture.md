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
- `policies/survival.js` — survival-focused heuristic policy
- `policies/progression.js` — XP/progression-focused heuristic policy

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
