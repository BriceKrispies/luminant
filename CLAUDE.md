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
- **Creatures**: Procedural creature rendering (`src/renderer/creatures/`) — archetypes, deformations, Canvas 2D drawing
- **Skeletal Animation**: Custom 2D skeletal interpolation + skinned-mesh animation engine (`src/animation/`) — skeleton, pose, clip, sampler, blend, constraints, IK, mesh skinning, rig controller, runtime
- **Content**: Data definitions (`src/content/`), rigged character data (`src/content/rigs/`, `src/content/animations/`)
- **UI**: Menu, DOM HUD, level-up, game-over, upgrade picker (`src/ui/`)
- **Harnesses**: Headless, benchmark, batch sim, evolution (`harness/`)
- **Studio**: Offline creature preview/render tool (`studio/`) — browser-based rig inspector + Node.js PNG export

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
Snapshot includes `facing` field (radians) for directional creature rendering.

## Renderer

Dual-backend system with runtime switching:
- **WebGPU** (`webgpu-renderer.js`): Instanced entity rendering, WGSL shaders, orthographic projection. Effects (slash, hit, death) drawn via Canvas 2D overlay.
- **Canvas 2D** (`canvas-renderer.js`): Layered drawing (ground, lights, entities, effects, fog).
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
  - `rig-data.js` — Complete rig data for all 4 archetypes (skeletons, slots, clips, expressions, overlays)
  - `archetypes.js` — Visual definitions with rig references, entity type mapping, seeded PRNG
  - `deformations.js` — Legacy deformation layers (wobble, breathing, squash-stretch, hit, death), still used for body shape wobble
  - `creature-model.js` — Resolver with skeleton-based primary path and legacy fallback
  - `draw-canvas.js` — Dual-path drawing: skeleton slot/attachment rendering + legacy shape rendering
  - `svg-renderer.js` — SVG export for offline/studio creature rendering
  - `shapes/ghost.js` — Custom ghost body shape draw function
  - Both backends draw creatures via Canvas 2D (WebGPU uses its effects overlay canvas)

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

**Renderer integration:** `src/renderer/skinned-entities.js` — checks entity type, runs animation runtime, draws deformed mesh triangles. ENEMY_FAST uses skinned path. Debug overlay shows bones, wireframe, IK targets, anim state. Integrates via `drawEntities()` in existing pipeline.

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

## AI / Policy System

- **Auto-mode only** — AI brawler policy controls the player, no manual play or policy selection in UI
- **Default policy: brawler** — aggressive, dives into clusters, highest scoring in batch sim
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

Debug overlay (`F3`) shows utility AI state: current intention, danger/encirclement levels, intention scores, and top candidate moves.

### Neural Policy (`src/ai/neural/`)

Neuroevolution-trained feedforward network as a drop-in policy replacement.

- **`feedforward.js`** — Pure JS `FeedforwardNetwork` class: arbitrary topology, ReLU hidden layers, raw output, flat weight get/set, JSON serialization
- **`encode.js`** — Encodes sensor-enriched observation into 53 normalized floats for network input
- **`neural-policy.js`** — Policy wrapper registered as `'neural'`. Uses sensors for observation enrichment, brawler's upgrade strategy for level-ups. Output mapping: tanh for dx/dy, sigmoid for attack, tanh*PI for aim offset
- **`trained-weights.json`** — Serialized best network from training (topology + flat weights + fitness history)
- **Training**: `npm run train` runs `harness/neuroevolve.js` with worker pool (`harness/neuro-worker.js`). Population-based search: gaussian mutation, no crossover, elite selection, periodic random injection. Checkpoints every 10 gens to `results/`.
- **Topology**: [53, 32, 16, 4] = 2,324 parameters. 53 inputs from sensor layer, 4 raw outputs mapped to actions.
- **To use in-game**: Change `main.js` `setPolicy('brawler')` to `setPolicy('neural')` after training

## PWA / Service Worker

- Service worker (`public/sw.js`) uses build-hash cache busting (injected by Vite plugin at build time)
- Network-first for HTML, cache-first for hashed assets, stale-while-revalidate for WASM/icons
- Auto-updates: checks every 60s, `skipWaiting` + `controllerchange` triggers reload

## Extending Safely

- New enemy type: add to `content/enemy-types.js`, types 2-9 auto-handled by WAT; add visual archetype in `renderer/creatures/archetypes.js`; add skeleton, slots, clips, expression profile, overlay config in `rig-data.js`; register secondary in `secondaries.js`
- New creature archetype: add to `archetypes.js` with `skeletonId`/`secondaryId`/`expressionId`, add skeleton + slots + clips in `rig-data.js`, add shape draw function in `draw-canvas.js`, add TYPE_TO_ARCHETYPE mapping
- New creature skin: create SkinDef, call `registerSkin()` in `skins.js` — can override palette, slots, clips, secondary/expression profiles
- New skinned rigged character: create rig in `content/rigs/`, clips in `content/animations/`, add entity type check in `skinned-entities.js`. See `docs/extending.md`.
- New animation clip: add to the character's clip file, reference bone names from the rig's skeleton
- New weapon: add to `content/weapon-types.js` + upgrade in `upgrade-pool.js`
- New system: create in `src/systems/`, wire in `src/main.js`
- New policy: create in `src/ai/policies/`, call `registerPolicy()`, see `docs/extending.md`
- New renderer backend: implement interface, register in manager, see `docs/extending.md`
- WAT changes: edit `engine/core.wat`, run `npm run build:wat`, run `npm test`
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
buffer reuse, missing fields), neural policy interface (registration, act shape, custom weights).

## Maintenance Rule

After adding or updating any system in this repository, update this CLAUDE.md file to reflect the change. This includes new systems, modified behaviors, new content types, new policies, changed invariants, and updated module boundaries. CLAUDE.md is the authoritative quick-reference for the codebase — it must stay current.
