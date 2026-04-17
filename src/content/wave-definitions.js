/**
 * Phase-based progression table.
 * Director interpolates between phases using game time.
 * All scaling is smooth — no discrete jumps.
 */

export const PHASES = [
  // Phase 1 (0–60s): Power fantasy. Easy kills, fast XP, quick upgrades.
  {
    startTime: 0,
    endTime: 60,
    types: ['basic'],
    spawnInterval: [1.2, 0.6],   // lerp from start to end
    spawnBatch: [2, 4],
    maxConcurrent: [20, 50],
    hpScale: [0.6, 0.7],         // enemies are soft
    speedScale: [0.8, 0.9],
    xpScale: [1.8, 1.5],         // generous XP
    spawnDist: [450, 400],
  },
  // Phase 2 (60–180s): Movement variety. Orbiters/kiters/zigzag join in.
  {
    startTime: 60,
    endTime: 180,
    types: ['basic', 'fast', 'tank', 'zigzag', 'orbiter', 'kiter'],
    spawnInterval: [0.6, 0.35],
    spawnBatch: [4, 6],
    maxConcurrent: [50, 120],
    hpScale: [0.8, 1.0],
    speedScale: [0.9, 1.0],
    xpScale: [1.3, 1.0],
    spawnDist: [400, 350],
  },
  // Phase 3 (180–300s): Tactical variety. Chargers, flankers, retreaters.
  {
    startTime: 180,
    endTime: 300,
    types: ['basic', 'fast', 'tank', 'ranged', 'orbiter', 'kiter', 'zigzag', 'charger', 'flanker', 'retreater'],
    spawnInterval: [0.35, 0.2],
    spawnBatch: [6, 10],
    maxConcurrent: [120, 250],
    hpScale: [1.0, 1.4],
    speedScale: [1.0, 1.15],
    xpScale: [1.0, 0.8],
    spawnDist: [350, 280],
  },
  // Phase 4 (300–420s): Full chaos. Shooters, summoners, ambushers unlocked.
  {
    startTime: 300,
    endTime: 420,
    types: [
      'basic', 'fast', 'tank', 'ranged', 'orbiter', 'kiter',
      'zigzag', 'charger', 'flanker', 'retreater', 'ambusher', 'summoner',
    ],
    spawnInterval: [0.2, 0.1],
    spawnBatch: [10, 16],
    maxConcurrent: [250, 500],
    hpScale: [1.4, 2.0],
    speedScale: [1.15, 1.4],
    xpScale: [0.8, 0.6],
    spawnDist: [280, 200],
  },
];

/** Kept for backward compat with any code referencing WAVE_TABLE */
export const WAVE_TABLE = PHASES;
