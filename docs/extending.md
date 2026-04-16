# Extending Luminant

## Adding a New Enemy Type

1. Add a type constant in `src/engine/bindings.js` (e.g., `ENEMY_BOSS: 6`)
2. Add a definition in `src/content/enemy-types.js` with hp, speed, radius, damage, xp, color
3. The WAT engine already handles types 2-9 as enemies — no WAT changes needed
4. Optionally add custom rendering in `src/renderer/entities.js`
5. Add the new type key to wave definitions in `src/content/wave-definitions.js`

## Adding a New Weapon

1. Add a definition in `src/content/weapon-types.js`
2. Supported patterns: `single`, `spread`, `burst`
3. Add an unlock upgrade in `src/content/upgrade-pool.js`
4. Optionally add a projectile type if it needs distinct visuals

## Adding a New Upgrade

1. Add an entry to `src/content/upgrade-pool.js`
2. Stat fields: `speedBonus`, `maxHpBonus`, `damageMultiplier`, `cooldownMultiplier`, `projectileSpeedBonus`, `pickupRadius`, `armor`, `regenRate`
3. Special fields: `weapon` (switches weapon), `healOnPickup` (instant heal)
4. Set `maxStacks` to control how many times it can be picked

## Adding a New Rendering Effect

1. Add an effect type string in `src/renderer/effects.js`
2. Add drawing code in the `drawEffects` function
3. Trigger with `addEffect(type, x, y, data)` from game code

## Adding a New Creature Archetype

The procedural creature system in `src/renderer/creatures/` draws enemies as
skeleton-rigged animated creatures. Each enemy type maps to a visual archetype
with a full rigging pipeline: skeleton → animation clips → overlays →
secondary motion → expression → slot/attachment rendering.

1. Add a new archetype definition in `src/renderer/creatures/archetypes.js`:
   - `body` — shape type, aspect ratio, segment count, shape-specific params
   - `eyes` — count, size, offset, spread, style (dot/glow/slit/angry)
   - `palette` — base, highlight, glow, eye, interior colors (0-1 RGB arrays)
   - `deform` — wobble, breathing, squash-stretch, hit, death animation config
   - `variation` — ranges for seeded per-entity randomization
   - `skeletonId`, `secondaryId`, `expressionId` — rig reference IDs
2. Add rig data in `src/renderer/creatures/rig-data.js`:
   - `SKELETON_DEFS[id]` — ordered bone array (root first, parents before children)
   - `SLOT_DEFS[id]` — slot/attachment layout with draw ordering
   - `CLIP_DEFS[id]` — animation clips (idle, locomotion, attack, hit_react, dying)
   - `EXPRESSION_PROFILES[id]` — per-expression eye/brow params, blink config
   - `OVERLAY_CONFIGS[id]` — breathing, hover bob, recoil, etc. parameters
3. Register a secondary motion module in `src/renderer/creatures/secondaries.js`
4. Add the entity type → archetype mapping in `TYPE_TO_ARCHETYPE`
5. Add a pixel draw function in `draw-pixel.js`
6. Add tests in `test/creatures.test.js` and `test/rigging.test.js`

### Adding a New Creature Skin

Skins allow palette/attachment/clip/profile variations without new archetypes:

1. Create a `SkinDef` in `src/renderer/creatures/skins.js`
2. Call `registerSkin(id, skinDef)` to register it
3. Skin can override: `palette`, `slotOverrides`, `clipOverrides`,
   `secondaryId`, `expressionId`, `variation`
4. The resolver uses `resolveSkin(archetype, skin)` to merge overrides

Existing mappings: player→player, basic→slime(blob), fast→ghost(wisp), tank→brute(hulk), ranged→ember(flame).

The creature system is shared by both renderers. Canvas 2D draws creatures
directly; WebGPU draws them on its Canvas 2D overlay canvas.

### Adding Progression Visuals for Another Archetype

The visual progression system (`src/renderer/creatures/progression.js`) derives
a bounded progression state from entity level. By default, non-player archetypes
get a minimal default config (glow only, no tendrils/halo).

To add custom progression for an archetype:

1. Create a progression config object based on `PLAYER_PROGRESSION` or
   `DEFAULT_PROGRESSION` in `progression.js`. Set milestone levels, unlocked
   features, intensity curve, glow/tendril/halo parameters.
2. Register it: `registerProgressionConfig('archetype_id', myConfig)`
3. The creature pipeline automatically picks it up — `creature-model.js`
   derives progression state and `draw-pixel.js` renders it.
4. For custom rendering beyond the built-in effects, add draw functions
   in `progression-visuals.js` and wire them into `drawProgressionEffects()`.

Tuning parameters (all in the config object):
- `milestones` — array of `{ level, label, unlocks }` milestone definitions
- `intensityScale` — higher = slower intensity curve growth
- `glowMaxAlpha`, `glowMaxRadius` — glow caps
- `tendrilMaxCount`, `tendrilMaxLength` — tendril caps
- `haloStages`, `haloMaxAlpha` — halo tier caps
- `modFreqBase`, `hueShiftMax` — infinite modulation tuning

Preview in the studio: `npm run studio`, use the Progression section controls
to set level, XP progress, seed, and toggle individual features on/off.
The debug panel shows the full computed progression state.

## Adding a New Renderer Backend

1. Create a file in `src/renderer/`, e.g. `my-renderer.js`
2. Export a factory: `createMyRenderer(canvas)` returning an object with:
   - `id` — machine identifier (e.g. `'webgl'`)
   - `name` — human-readable name (e.g. `'WebGL 2'`)
   - `async init()` — acquire context and set up resources
   - `resize()` — handle canvas/viewport resize
   - `render(snapshot, camera)` — draw a frame
   - `dispose()` — release resources and event listeners
3. Use `validateRenderer(renderer)` from `renderer-interface.js` to verify the contract
4. Register the backend in `renderer-manager.js`:
   - Add detection logic (like `detectWebGPU()`)
   - Add the ID to the factory switch in `_startRenderer()`
   - Add to the `available` getter
5. Runtime switching (F4 / badge click) and preference persistence are handled automatically

## Adding a New System

1. Create a file in `src/systems/`
2. Export a factory function: `createXxxSystem(engine, ...deps)`
3. Wire it into `src/main.js` in the game loop
4. If it needs per-frame updates, add to the fixed-timestep loop
5. If it modifies entities, use `engine.setF32()` / `engine.setI32()`

## Modifying the WAT Engine

The WAT module at `engine/core.wat` handles:
- Entity storage and allocation
- Spatial grid maintenance
- Movement (player, enemies, projectiles)
- Collision detection and damage
- Death processing

**To add a new entity field**: Increase `ENTITY_STRIDE` (currently 64 bytes) and update offsets. This requires changes in both `core.wat` and `src/engine/bindings.js`.

**To improve enemy AI**: Modify `$update_enemies` in the WAT. The current implementation uses direct pursuit + same-cell separation. Structured to allow adding flow fields or nav improvements.

**To add spatial partitioning improvements**: The grid is a 64×64 uniform grid. To add a quadtree or hierarchical grid, replace `$rebuild_grid` and related functions.

After any WAT changes, rebuild with `npm run build:wat` and re-run tests.

## Adding a New Rigged Character (Skeletal Animation)

The skeletal animation system in `src/animation/` provides bone-driven mesh
deformation for characters. The first rigged character is the ghost witch
(ENEMY_FAST). To add a new one:

### 1. Create a rig file

Create `src/content/rigs/my-character-rig.js`:

```js
import { bone, slot, createSkeleton } from '../../animation/skeleton.js';
import { createWeightedMesh } from '../../animation/mesh.js';

const BONES = [
  bone('root', -1, 0, { x: 0, y: 0 }),
  bone('torso', 0, 5, { x: 0, y: -3 }),
  // ... more bones (parent index must be < current index)
];

// Build meshes with per-vertex bone weights
const BODY_MESH = createWeightedMesh([
  { x: -3, y: -3, bones: [[1, 1.0]] },  // 100% torso
  { x: 3, y: -3, bones: [[1, 0.7], [0, 0.3]] },  // 70% torso, 30% root
  // ...
], [0, 1, 2], '#1a0e2a');

export const MY_SKELETON = createSkeleton(BONES, [], {});
export const MY_MESHES = [BODY_MESH];
export const MY_CONFIG = { hoverAmp: 0.5, ... };
export const MY_CONSTRAINTS = { lookBone: 'head', trails: [] };
```

### 2. Create animation clips

Create `src/content/animations/my-character-clips.js`:

```js
import { clip, track, kf } from '../../animation/clip.js';

export const IDLE = clip('idle', 2.0, [
  track('torso', { rot: [kf(0, 0), kf(1, 0.02), kf(2, 0)] }),
], { loop: true });

// Required clips: idle, drift, chase, hit_react, death, spawn
export const MY_CLIPS = { idle: IDLE, ... };
```

### 3. Register in the renderer

Edit `src/renderer/skinned-entities.js`:
- Import the rig and clips
- Add the entity type check in `isSkinnedEntity()`
- Wire up the runtime creation in `getRuntimeForEntity()`

### 4. Add tests

Add tests in `test/animation.test.js` to verify:
- All clip bone references are valid against the skeleton
- Skinning produces non-zero vertices

### Animation clip authoring tips

- Keyframe times are in seconds, rotation in radians
- Clips loop by default (`{ loop: false }` for one-shots like attack/death)
- Only animate bones that need to move — others stay at bind pose
- Procedural overlays (hover, lean, recoil) are applied automatically by the runtime

### Runtime update order

```
Entity snapshot → Controller (state machine, clip selection)
  → Sample base clip → Crossfade blend → Additive procedural layer
  → World pose → Constraints (aim, trail) → IK → Skin meshes → Render
```

## Adding a New AI Policy

There are two approaches: **utility-based** (recommended) and **legacy**.

### Utility-based policy (weight profile)

The utility AI system in `src/systems/player-ai/` provides a shared decision pipeline.
New policies are just weight profiles — no AI code needed.

1. Create a file in `src/systems/player-ai/policies/`, e.g. `my-policy.js`
2. Define a weight object covering intention weights, behavioral params, and upgrade preferences
3. Use `createUtilityPolicy()` to create the policy from weights
4. Call `registerPolicy()` at module level
5. Import your policy in `src/systems/player-ai-system.js` and `src/ui/menu.js`

Example:
```js
import { registerPolicy } from '../../../ai/policy-types.js';
import { createUtilityPolicy, mergeWeights } from '../create-utility-policy.js';

const MY_WEIGHTS = {
  // Intention weights (higher = more likely to choose that intention)
  flee: 1.0,
  kite: 1.5,
  hold_range: 1.0,
  reposition_for_shot: 1.0,
  collapse_on_cluster: 0.5,
  collect_xp: 1.0,
  boss_focus: 0.5,
  maintain_pressure: 1.0,
  hold_ground: 0.5,

  // Candidate scoring
  dangerWeight: 1.0,    // how much to penalize dangerous directions
  rewardWeight: 1.0,    // how much to reward beneficial directions

  // Behavioral params
  survivalBias: 0.5,
  preferredSpacing: 1.0, // multiplier on weapon preferred range
  commitmentTime: 8,     // ticks before allowing intention switch
  smoothingRate: 0.3,    // movement smoothing (0=sluggish, 1=instant)
  retreatThreshold: 0.3, // HP ratio below which flee is boosted
  damageRiskTolerance: 0.5,
  attackEagerness: 1.0,

  // Upgrade selection weights
  upgradeWeights: {
    survivability: 1.0, damage: 1.0, aoe: 1.0,
    speed: 1.0, utility: 1.0, scaling: 1.0,
  },
};

function createMyPolicy(overrides = {}) {
  return createUtilityPolicy('My Policy', 'my-policy', mergeWeights(MY_WEIGHTS, overrides));
}

registerPolicy('my-policy', createMyPolicy);
```

#### Tuning utility weights

- **Intention weights** control what the AI *wants* to do. Higher `flee` = more retreating,
  higher `collapse_on_cluster` = more aggressive dives into groups.
- **dangerWeight/rewardWeight** control how much directional danger and reward maps
  influence candidate scoring.
- **commitmentTime** prevents jitter — higher values mean the AI commits longer to each decision.
- **retreatThreshold** sets the HP ratio at which the AI panics and flees regardless of intention.
- **attackEagerness** controls how readily the AI swings at clusters.

#### Adding new sensed signals

Add new fields to `sensors.sense()` in `src/systems/player-ai/sensors.js`.
Sensor data is a superset of observations — all existing observation fields are available.

#### Adding new intentions

1. Add the intention name to `INTENTIONS` in `src/systems/player-ai/utility-scorer.js`
2. Add its scoring formula in `scoreIntentions()`
3. Add its candidate fitness calculation in `scoreSingleCandidate()`
4. Add a weight key for it in policy weight profiles

### Legacy policy (custom AI)

1. Create a file in `src/ai/policies/`, e.g. `my-policy.js`
2. Import `registerPolicy` from `../policy-types.js`
3. Implement a factory function that returns an object with:
   - `name` — human-readable name
   - `id` — machine identifier
   - `params` — tunable parameter object
   - `reset()` — called at start of each run
   - `act(observation)` — returns `{ dx, dy, attack, targetX, targetY }`
   - `chooseUpgrade(choices, observation)` — returns upgrade id
4. Call `registerPolicy(id, factory)` at module level
5. Import your policy in `src/systems/player-ai-system.js` and `src/ui/menu.js`

```js
import { registerPolicy } from '../policy-types.js';

function createMyPolicy(params = {}) {
  return {
    name: 'My Policy', id: 'my-policy', params,
    reset() {},
    act(obs) {
      return { dx: 0, dy: 0, attack: true, targetX: obs.nearestEnemyX, targetY: obs.nearestEnemyY };
    },
    chooseUpgrade(choices, obs) { return choices[0]?.id; },
  };
}

registerPolicy('my-policy', createMyPolicy);
```

## Adding a New Upgrade Decision Strategy

1. Define a weight set in `src/ai/upgrade-strategies.js` (or create a new preset)
2. Use `scoreUpgrade(choice, weights, obs)` to evaluate options
3. Override `chooseUpgrade` in your policy, or pass weights to the shared `chooseUpgrade()` function

## Running Batch Simulations

```bash
# Single AI game
npm run sim -- --policy=survival --maxTicks=30000

# 50 runs with the progression policy
npm run batch -- --runs=50 --policy=progression --seed=1000

# Results written to results/ as JSONL + summary JSON
```

## Running Evolution Search

```bash
# Evolve survival policy parameters over 5 generations
npm run evolve -- --policy=survival --pop=8 --gens=5 --runs=3

# Results written to results/ as JSON with best params + history
```

## Inspecting Results

- JSONL files: one JSON object per line, each is a complete run result
- Summary files: aggregate stats + analysis (upgrade paths, weapon performance)
- Evolution files: best params, generation history, improvement curve
- Use `src/ai/analysis.js` programmatically for custom reporting

## Adding Tests

1. Create a `.test.js` file in `test/`
2. Import the engine loader: `import { loadEngine } from '../src/engine/loader.js'`
3. Create `EngineBindings` in `beforeEach`
4. Run with `npm test`

## Running Harnesses

- **Headless**: `npm run headless -- --enemies=500 --ticks=600`
- **Benchmark**: `npm run benchmark`
- **Single AI run**: `npm run sim -- --policy=survival`
- **Batch runs**: `npm run batch -- --runs=50 --policy=progression`
- **Evolution**: `npm run evolve -- --policy=survival --pop=8 --gens=5`
- **Debug view**: `npm run debug` (opens browser debug page)

## Simulation Lab

The simulation lab (`src/lab/`) provides offline bot experimentation, reward
analysis, lineage tracking, and upgrade analytics.

### Running the Lab

```bash
# Batch simulation with default bot
npm run lab:batch -- --runs=20 --seed=42

# Batch with bias presets
npm run lab:batch -- --runs=20 --bias=survival --bias=xp_collection

# Batch with mutation (evolutionary drift)
npm run lab:batch -- --runs=20 --bias=aoe_opportunity --mutate

# Evolutionary search
npm run lab:evolve -- --pop=8 --gens=5 --bias=elite_targeting

# Replay a stored run artifact
npm run lab:replay -- --artifact=results/lab/batch-2026-04-15T12-00-00.jsonl

# Replay with forced original upgrade choices
npm run lab:replay -- --artifact=results/lab/batch-2026-04-15T12-00-00.jsonl --forced

# Generate analytics from all stored artifacts
npm run lab:analytics

# Open the lab debug UI in browser
npm run lab:ui
```

### Available Bias Presets

- `survival` — high flee/kite, low aggression, defensive upgrades
- `xp_collection` — high pickup greed, reward-focused
- `keep_distance` — kiting, long-range spacing
- `aoe_opportunity` — cluster diving, AOE upgrades
- `elite_targeting` — boss focus, damage upgrades
- `low_hp_caution` — extra retreat, low risk tolerance

Biases can be stacked: `--bias=survival --bias=xp_collection`

### Adding a New Reward Component

1. Add a weight key to `DEFAULT_REWARD_WEIGHTS` in `src/lab/rewards.js`
2. Add computation logic in `computeRewardBreakdown()` — push a component
   object with `{ name, raw, weight, contribution }`
3. The component will automatically appear in analytics, the debug UI,
   and artifact reward breakdowns
4. Add a test in `test/simulation-lab.test.js`

### Adding a New Bot Policy Signal

1. Add a new bias preset to `BIAS_PRESETS` in `src/lab/bot.js` with the
   weight overrides that emphasize the behavior
2. Add a range entry to `WEIGHT_RANGES` if the new weight needs custom bounds
3. The preset is immediately available via `--bias=your_name` in the CLI
4. For new sensor signals, extend `sensors.js` per the utility AI section above

### Adding a New Analytics Metric

1. Add an analysis function in `src/lab/analytics.js`
2. Include it in the `analyzeUpgrades()` return object
3. Add display logic in `formatAnalyticsSummary()` for CLI output
4. Add rendering in `debug/simulation-lab.html` for the browser view
5. Add test coverage in `test/simulation-lab.test.js`

### Adding a New Lab View/Panel

1. Add a tab button and container div in `debug/simulation-lab.html`
2. Add the tab name to the `switchTab()` function
3. Write a render function that reads from the `artifacts` array
4. The UI runs entirely in-browser — no server needed

### Replay and Determinism

Replay works by re-running a simulation with the same seed and bot config.
The seeded PRNG replaces `Math.random` during simulation.

**Deterministic guarantees:**
- Same seed + same bot config + same game code → same simulation
- Upgrade choices are deterministic given same observations + same weights

**Known gaps:**
- No game-code versioning — if you change game systems between record and
  replay, results will diverge
- Floating-point micro-divergence is possible on very long runs across
  different platforms
- Forced-upgrade replay (`replayWithForcedUpgrades`) provides tighter
  reproduction by overriding `chooseUpgrade` with the stored sequence
