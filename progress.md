# Luminant — Progress

## Completed

### v0 — Foundation (commit 7936d53)
- WAT/WASM engine core with entity memory, fixed timestep, spatial grid
- JS bindings, entity spawn/despawn, player input
- Game systems: spawner, combat, XP/leveling, weapons, skills, camera, cooldowns, feedback
- Canvas 2D renderer with layered drawing (ground, lights, entities, effects, fog)
- AI policy system with observations, scoring, survival + progression policies
- Menu UI, level-up picker, game-over screen
- Content definitions: enemy types, weapon types, upgrade pool
- Headless harness, benchmark, batch sim, evolution search
- PWA with service worker, cache busting, auto-update
- Full test suite covering engine, systems, AI, and harness

### v1 — WebGPU + Auto Mode (commits 933e034 → 70ca9e1)
- WebGPU renderer with instanced rendering, WGSL shaders, orthographic projection
- Renderer manager with runtime toggle (F4), WebGPU detection, preference persistence
- Canvas element replacement on context switch (one context type per canvas)
- Removed manual play mode — auto mode is the only way to play
- Smart AI attacks (swing only when enemies in range + weapon ready)
- Sword cooldown system
- Upgrade chooser for auto-mode
- PWA cache-bust fix for deploys
- Auto upgrade log (on-screen + mobile fix)

### v2 — Creature System + Utility AI + DOM HUD (uncommitted)

#### Procedural Creature Rendering (`src/renderer/creatures/`)
- Full skeleton-based rigging pipeline: bone hierarchy, flat Float64Array poses, world transform solver
- Animation system: clip/track/keyframe with easing, additive/multiplicative composition, looping + one-shot
- Animation controller: state machine (idle/locomotion/attack/hit_react/dying), crossfade, priority interrupts
- Slot/attachment system with draw ordering, layered overrides (skin/expression/temp), deformation seam
- Additive overlays: breathing, hover bob, recoil, tension, head look, weapon follow-through
- Per-archetype secondary motion: ghost drift, ember flicker, brute settle, slime bounce
- Expression system: face blending, auto-blink, pupil bias (neutral/angry/surprised/hurt/dead/focused)
- Skin/variant system: palette, slot, clip, and profile overrides via `registerSkin()`
- Complete rig data for 4 archetypes (slime, ghost, brute, ember)
- Entity type → archetype mapping: basic→slime, fast→ghost, tank→brute, ranged→ember
- Legacy deformation path preserved as fallback
- Creature resolver with caching, dual pipeline (skeleton primary, legacy fallback)
- Canvas 2D drawing with skeleton slot/attachment path + legacy shape path
- SVG renderer for offline export
- Both renderers draw creatures via Canvas 2D (WebGPU uses effects overlay)
- Snapshot includes `facing` field for directional rendering
- Character design art in `docs/characters/`

#### Utility-Based Player AI (`src/systems/player-ai/`)
- Sensors: encirclement, directional danger/reward maps, closing speed, preferred range, cluster detection
- Utility scorer: 9 intentions × 11 candidate moves with weighted fitness
- Movement planner: hysteresis/commitment, exponential smoothing, flee override
- Upgrade strategy: build-aware selection with weapon synergy scoring
- Factory pattern: `createUtilityPolicy()` wires sensors → scorer → planner for any weight profile
- 4 utility policies: coward, kiter, brawler, farmer (weight profiles only, no custom AI code)
- Boss/elite tracking: elite system exposes `_activeEliteIds()`, main loop feeds boss context to AI
- Debug overlay shows AI state: intention, danger, encirclement, scores, top candidates
- Replaces old `auto-player.js` with `player-ai-system.js`

#### DOM HUD (`src/ui/hud.js`)
- Replaced in-canvas HUD (`ui-render.js` deleted) with DOM-based HUD
- Grouped HP/XP clusters with frosted-glass card styling
- CSS design tokens (`--hud-*`) for consistent theming
- Renderer signature simplified: `render(snapshot, camera)` — no longer receives `gameState`
- Responsive mobile adjustments

#### Studio (`studio/`)
- Browser-based creature rig inspector (`studio.js`, `studio-rig.js`)
- Node.js PNG export (`render.js`) using `canvas` package
- SVG conversion script (`scripts/convert-svg.js`)

#### Infrastructure
- `canvas` dev dependency added for Node.js creature rendering
- New npm scripts: `studio`, `render`
- Package renamed to `luminant`
- Harnesses + menu import all 4 utility policies
- Tests: `creatures.test.js`, `player-ai.test.js`, `rigging.test.js`
- Updated docs: `architecture.md`, `extending.md`, `CLAUDE.md`

#### Visual Progression System (`src/renderer/creatures/progression.js`, `progression-visuals.js`)
- Data-driven progression state derivation: tier, bounded intensity (asymptotic curve), modulation phase, unlocked feature flags
- Player-specific 9-milestone config spanning levels 1-50: glow → tendrils → glow pulse → halo → tendril motion → crown → second-order motion → ascended
- Bounded visual effects: body glow (radial, pulsing), energy tendrils (animated wisps), halo/crown (overhead rings + crown points), level-up burst (flash + ring + particles)
- All rendering at pixel-art scale (1 world-unit pixels), works with both Canvas 2D and WebGPU overlay paths
- Per-archetype progression config registry with default fallback for non-player archetypes
- Infinite modulation: phase, hue/temperature drift, second-order amplitude — never unbounded
- Level-up burst state tracker with trigger/progress/deactivate lifecycle
- Integrated into creature-model.js resolver (both skeleton and legacy paths) and draw-pixel.js
- Studio expansion: level slider (1-60), XP progress, seed control, per-feature toggles (glow/tendrils/halo/burst), progression debug panel with tier/intensity/features/derived params
- Tests: 39 tests covering tier computation, intensity bounds, feature unlocks, mod phase wrapping, full state determinism, level-band behavior, bounded element counts, burst lifecycle, config registry, debug formatting

## Next Steps

- Visual polish: creature rendering tuning, particle effects, screen shake
- More archetypes / skins for enemy variety
- Balance tuning via batch simulation + evolution on utility policies
- Sound / audio system
- More upgrade types and weapon variety
- Director system improvements (wave pacing, difficulty curve)
- Performance profiling with creature rendering at high entity counts
