# Luminant

Top-down survival-action game with WAT/WASM engine core.

## Architecture

- **Engine**: Raw WAT → WASM (`engine/core.wat` → `public/core.wasm`)
- **Bindings**: JS bridge over WASM memory (`src/engine/`)
- **Systems**: Game logic in JS (`src/systems/`)
- **AI/Policy**: Policy-driven auto mode + observations + scoring (`src/ai/`)
- **Renderer**: Dual-backend with manager (`src/renderer/`) — WebGPU default, Canvas 2D fallback
- **Content**: Data definitions (`src/content/`)
- **Harnesses**: Headless, benchmark, batch sim, evolution (`harness/`)

Engine owns entity data. Renderer reads snapshots. JS handles game rules.

See `docs/architecture.md` for full layout.

## Module Boundaries

| Layer | Reads | Writes | Never touches |
|-------|-------|--------|---------------|
| WAT Engine | Entity memory, input globals | Entity memory, metrics | DOM, canvas, game rules |
| Engine Bindings | WASM memory | WASM memory (via exports) | DOM, canvas |
| Game Systems | Engine bindings | Engine bindings | Canvas, DOM (except UI) |
| Renderer | Snapshots, camera | Canvas pixels | Engine memory |

## WAT ↔ JS Interface

JS calls WASM exports: `init`, `step`, `spawn_entity`, `despawn_entity`, `set_player_input`, `grid_query`, etc.
JS reads entity data directly from `memory.buffer` using typed array views.
Entity stride = 64 bytes. Field offsets defined in `src/engine/bindings.js`.
Entity types: 1=player, 2-9=enemies, 10-19=projectiles, 20+=pickups.
Entity states: 0=free, 1=active, 2=dying.

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
npm run build:wat    # Compile engine/core.wat → public/core.wasm
```

## Key Invariants

1. Engine never reads DOM or canvas
2. Renderer never writes to engine memory
3. All entity access goes through EngineBindings
4. Fixed timestep (1/60s) — clock accumulates and dispatches
5. JS handles spawn/despawn decisions, WAT handles per-entity math
6. Entity types 2-9 steer toward player in WAT
7. Entity types 10-19 move by velocity and expire by lifetime in WAT
8. Deaths: WAT sets state=2, JS processes dying entities (XP, pickups)

## AI / Policy System

- **Policies** produce actions (dx, dy, attack, target) from observations each tick
- **Observations** are built from engine state, never raw WASM memory
- **Upgrade strategies** are separate from movement policies
- **Scoring** is centralized in `src/ai/scoring.js`
- **Evolution** tunes policy parameters via `src/ai/evolution.js`
- Built-in policies: `survival` (kiting/safety), `progression` (XP farming)
- Policy input flows through the same `setPlayerInput()` path as manual play

| Layer | Reads | Writes | Never touches |
|-------|-------|--------|---------------|
| AI/Policy | Observations | Actions (dx,dy,attack) | Engine memory, DOM |

## Extending Safely

- New enemy type: add to `content/enemy-types.js`, types 2-9 auto-handled by WAT
- New weapon: add to `content/weapon-types.js` + upgrade in `upgrade-pool.js`
- New system: create in `src/systems/`, wire in `src/main.js`
- New policy: create in `src/ai/policies/`, call `registerPolicy()`, see `docs/extending.md`
- WAT changes: edit `engine/core.wat`, run `npm run build:wat`, run `npm test`
- See `docs/extending.md` for detailed instructions

## Test Coverage

Tests in `test/`: engine lifecycle, entity spawn/despawn, player movement,
enemy pursuit and separation, projectile collision, damage and death,
XP/leveling, weapon spawning, spawner placement, benchmark sanity,
simulation determinism, policy interface, observations, scoring,
upgrade strategies, batch harness output, evolution sanity.
