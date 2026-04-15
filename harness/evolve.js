/**
 * Evolution harness.
 * Runs evolutionary search over policy parameters to discover strong strategies.
 *
 * Usage:
 *   node harness/evolve.js [options]
 *
 * Options:
 *   --policy=ID         Base policy: survival, progression (default: survival)
 *   --pop=N             Population size per generation (default: 8)
 *   --gens=N            Number of generations (default: 5)
 *   --runs=N            Runs per individual (default: 3)
 *   --maxTicks=N        Max ticks per game (default: 18000)
 *   --seed=N            Base seed (default: 42)
 *   --output=PATH       Output file (default: results/evolve-<timestamp>.json)
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadEngine } from '../src/engine/loader.js';
import { evolve } from '../src/ai/evolution.js';
import { createPolicy, getDefaultParams } from '../src/ai/policy-types.js';

// Register policies
import '../src/ai/policies/survival.js';
import '../src/ai/policies/progression.js';
import '../src/systems/player-ai/policies/coward.js';
import '../src/systems/player-ai/policies/kiter.js';
import '../src/systems/player-ai/policies/brawler.js';
import '../src/systems/player-ai/policies/farmer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const args = parseArgs(process.argv.slice(2));
const POLICY_ID = args.policy || 'survival';
const POP = parseInt(args.pop) || 8;
const GENS = parseInt(args.gens) || 5;
const RUNS_PER = parseInt(args.runs) || 3;
const MAX_TICKS = parseInt(args.maxTicks) || 18000;
const SEED = parseInt(args.seed) || 42;

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUTPUT_DIR = resolve(ROOT, 'results');
const OUTPUT_FILE = args.output
  ? resolve(ROOT, args.output)
  : resolve(OUTPUT_DIR, `evolve-${POLICY_ID}-${timestamp}.json`);

/** Tunable parameter ranges for survival policy */
const SURVIVAL_RANGES = {
  dangerRadius: [20, 80],
  engageRadius: [80, 250],
  meleeEngageRadius: [25, 80],
  rangedEngageRadius: [60, 180],
  edgeAvoidDist: [40, 200],
  edgeAvoidWeight: [0.5, 3],
  fleeWeight: [0.3, 2],
  kiteWeight: [0.1, 1.5],
  threatSectorWeight: [0.2, 2],
  densityFleeThreshold: [2, 10],
  pickupGreed: [0, 1],
  pickupMaxDist: [50, 400],
  attackRange: [30, 200],
};

/** Tunable parameter ranges for progression policy */
const PROGRESSION_RANGES = {
  dangerRadius: [10, 60],
  meleeEngageRadius: [20, 70],
  rangedEngageRadius: [50, 160],
  chargeThreshold: [3, 12],
  chargeWeight: [0.1, 1],
  edgeAvoidDist: [30, 150],
  edgeAvoidWeight: [0.3, 2],
  pickupGreed: [0.2, 1.5],
  pickupMaxDist: [100, 500],
  lowHPFleeThreshold: [0.05, 0.4],
  riskTolerance: [0.3, 1],
  aggressiveRange: [80, 350],
};

const PARAM_RANGES = {
  survival: SURVIVAL_RANGES,
  progression: PROGRESSION_RANGES,
};

async function run() {
  console.log('========================================');
  console.log('  LUMINANT EVOLUTION SEARCH');
  console.log('========================================');
  console.log(`  Policy:      ${POLICY_ID}`);
  console.log(`  Population:  ${POP}`);
  console.log(`  Generations: ${GENS}`);
  console.log(`  Runs/eval:   ${RUNS_PER}`);
  console.log(`  Max ticks:   ${MAX_TICKS}`);
  console.log(`  Seed:        ${SEED}`);
  console.log(`  Output:      ${OUTPUT_FILE}`);
  console.log('========================================\n');

  const wasm = await loadEngine();
  const baseParams = getDefaultParams(POLICY_ID);
  const ranges = PARAM_RANGES[POLICY_ID] || SURVIVAL_RANGES;

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const startTime = performance.now();

  const result = await evolve({
    policyFactory: (params) => createPolicy(POLICY_ID, params),
    baseParams,
    paramRanges: ranges,
    populationSize: POP,
    generations: GENS,
    runsPerIndividual: RUNS_PER,
    eliteCount: Math.max(2, Math.floor(POP * 0.3)),
    maxTicks: MAX_TICKS,
    seed: SEED,
    wasm,
    onGeneration(gen, genResults) {
      const best = genResults[0];
      const worst = genResults[genResults.length - 1];
      console.log(
        `  Gen ${gen + 1}/${GENS}: ` +
        `best=${best.avgScore.toFixed(0)} ` +
        `worst=${worst.avgScore.toFixed(0)} ` +
        `spread=${(best.avgScore - worst.avgScore).toFixed(0)}`
      );
    },
  });

  const totalTime = (performance.now() - startTime) / 1000;

  // Write results
  const output = {
    config: { policyId: POLICY_ID, pop: POP, gens: GENS, runsPerEval: RUNS_PER, maxTicks: MAX_TICKS, seed: SEED },
    bestParams: result.bestParams,
    bestScore: result.bestScore,
    history: result.history,
    timestamp: new Date().toISOString(),
    totalTimeSeconds: Math.round(totalTime),
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log('\n========================================');
  console.log('  EVOLUTION RESULTS');
  console.log('========================================');
  console.log(`  Best score:  ${result.bestScore.toFixed(0)}`);
  console.log(`  Total time:  ${totalTime.toFixed(1)}s`);
  console.log('');
  console.log('  Best parameters:');
  for (const [key, val] of Object.entries(result.bestParams)) {
    if (typeof val === 'object') continue; // skip nested objects
    const base = baseParams[key];
    const diff = base !== undefined ? ` (base: ${base})` : '';
    console.log(`    ${key}: ${val}${diff}`);
  }
  console.log('');
  console.log('  Generation history:');
  for (const h of result.history) {
    console.log(`    Gen ${h.generation + 1}: best=${h.best.toFixed(0)} median=${h.median.toFixed(0)}`);
  }
  console.log('');
  console.log(`  Output: ${OUTPUT_FILE}`);
  console.log('========================================');
}

function parseArgs(args) {
  const result = {};
  for (const arg of args) {
    const m = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (m) result[m[1]] = m[2] !== undefined ? m[2] : true;
  }
  return result;
}

run().catch(err => {
  console.error('[evolve] FATAL:', err);
  process.exit(1);
});
