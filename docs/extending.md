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

## Adding a New Renderer Backend

1. Create a file in `src/renderer/`, e.g. `my-renderer.js`
2. Export a factory: `createMyRenderer(canvas)` returning an object with:
   - `id` — machine identifier (e.g. `'webgl'`)
   - `name` — human-readable name (e.g. `'WebGL 2'`)
   - `async init()` — acquire context and set up resources
   - `resize()` — handle canvas/viewport resize
   - `render(snapshot, camera, gameState)` — draw a frame
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

## Adding a New AI Policy

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
5. Import your policy in `src/main.js` and harness files to register it
6. The policy will auto-appear in the menu dropdown and CLI `--policy=` flag

Example:
```js
import { registerPolicy } from '../policy-types.js';

function createMyPolicy(params = {}) {
  return {
    name: 'My Policy',
    id: 'my-policy',
    params,
    reset() {},
    act(obs) {
      return { dx: 0, dy: 0, attack: true, targetX: obs.nearestEnemyX, targetY: obs.nearestEnemyY };
    },
    chooseUpgrade(choices, obs) {
      return choices[0]?.id;
    },
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
