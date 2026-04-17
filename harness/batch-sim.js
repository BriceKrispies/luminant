/**
 * Batch simulation harness.
 * Runs many headless games and collects structured results.
 *
 * Usage:
 *   node harness/batch-sim.js [options]
 *
 * Options:
 *   --runs=N           Number of runs (default: 10)
 *   --policy=ID        Policy to use: survival, progression (default: survival)
 *   --seed=N           Starting seed (default: random)
 *   --maxTicks=N       Max ticks per run (default: 30000 ≈ 8.3 min)
 *   --output=PATH      Output JSONL file (default: results/batch-<timestamp>.jsonl)
 *   --silent            Suppress per-run output
 *   --snapshots        Record periodic snapshots per run
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadEngine } from '../src/engine/loader.js';
import { runGame } from '../src/ai/game-runner.js';
import { createPolicy, listPolicies } from '../src/ai/policy-types.js';
import { aggregateResults } from '../src/ai/scoring.js';
import { analyzeResults } from '../src/ai/analysis.js';

// Register policies
import '../src/ai/policies/survival.js';
import '../src/ai/policies/progression.js';
import '../src/systems/player-ai/policies/coward.js';
import '../src/systems/player-ai/policies/kiter.js';
import '../src/systems/player-ai/policies/brawler.js';
import '../src/systems/player-ai/policies/strategist.js';
import '../src/systems/player-ai/policies/farmer.js';
import '../src/systems/player-ai/policies/obliterator.js';
import '../src/ai/neural/neural-policy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const args = parseArgs(process.argv.slice(2));
const RUNS = parseInt(args.runs) || 10;
const POLICY_ID = args.policy || 'survival';
const START_SEED = parseInt(args.seed) || Math.floor(Math.random() * 1000000);
const MAX_TICKS = parseInt(args.maxTicks) || 30000;
const SILENT = 'silent' in args;
const SNAPSHOTS = 'snapshots' in args;

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUTPUT_DIR = resolve(ROOT, 'results');
const OUTPUT_FILE = args.output
  ? resolve(ROOT, args.output)
  : resolve(OUTPUT_DIR, `batch-${POLICY_ID}-${timestamp}.jsonl`);
const SUMMARY_FILE = OUTPUT_FILE.replace('.jsonl', '-summary.json');

async function run() {
  console.log('========================================');
  console.log('  LUMINANT BATCH SIMULATION');
  console.log('========================================');
  console.log(`  Policy:    ${POLICY_ID}`);
  console.log(`  Runs:      ${RUNS}`);
  console.log(`  Seed:      ${START_SEED}`);
  console.log(`  Max ticks: ${MAX_TICKS}`);
  console.log(`  Output:    ${OUTPUT_FILE}`);
  console.log(`  Available: ${listPolicies().join(', ')}`);
  console.log('========================================\n');

  // Pre-load WASM once
  const wasm = await loadEngine();

  // Ensure output dir exists
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const results = [];
  const startTime = performance.now();

  // Clear output file
  writeFileSync(OUTPUT_FILE, '');

  for (let i = 0; i < RUNS; i++) {
    const seed = START_SEED + i;
    const policy = createPolicy(POLICY_ID);

    if (!SILENT) {
      process.stdout.write(`Run ${i + 1}/${RUNS} (seed=${seed})... `);
    }

    const t0 = performance.now();
    const result = await runGame({
      policy,
      seed,
      maxTicks: MAX_TICKS,
      wasm,
      recordSnapshots: SNAPSHOTS,
      silent: true,
    });
    const elapsed = performance.now() - t0;

    results.push(result);

    // Append to JSONL
    const line = JSON.stringify({
      ...result,
      snapshots: undefined, // don't bloat JSONL with snapshots
    });
    writeFileSync(OUTPUT_FILE, line + '\n', { flag: 'a' });

    if (!SILENT) {
      console.log(
        `${elapsed.toFixed(0)}ms | ` +
        `T=${result.survivalTime.toFixed(0)}s L${result.level} ` +
        `K${result.kills} W${result.wave} ` +
        `Score=${result.score} ` +
        `${result.survived ? 'ALIVE' : 'DEAD'}`
      );
    }
  }

  const totalTime = (performance.now() - startTime) / 1000;

  // Aggregate stats
  const aggregate = aggregateResults(results);
  const analysis = analyzeResults(results);

  const summary = {
    config: {
      policyId: POLICY_ID,
      runs: RUNS,
      startSeed: START_SEED,
      maxTicks: MAX_TICKS,
    },
    aggregate,
    analysis,
    timestamp: new Date().toISOString(),
    totalTimeSeconds: Math.round(totalTime * 10) / 10,
  };

  writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));

  console.log('\n========================================');
  console.log('  RESULTS SUMMARY');
  console.log('========================================');
  console.log(`  Runs:             ${aggregate.count}`);
  console.log(`  Best score:       ${aggregate.bestScore}`);
  console.log(`  Median score:     ${aggregate.medianScore}`);
  console.log(`  Mean score:       ${aggregate.meanScore.toFixed(1)}`);
  console.log(`  Std dev:          ${aggregate.stdScore.toFixed(1)}`);
  console.log(`  Avg survival:     ${aggregate.avgSurvivalTime.toFixed(1)}s`);
  console.log(`  Avg level:        ${aggregate.avgLevel.toFixed(1)}`);
  console.log(`  Avg kills:        ${aggregate.avgKills.toFixed(0)}`);
  console.log(`  Max level:        ${aggregate.maxLevel}`);
  console.log(`  Max kills:        ${aggregate.maxKills}`);
  console.log(`  Survived:         ${aggregate.survivedCount}/${aggregate.count}`);
  console.log(`  Total time:       ${totalTime.toFixed(1)}s`);
  console.log('');

  if (analysis.topUpgradePaths.length > 0) {
    console.log('  Top upgrade paths:');
    for (const p of analysis.topUpgradePaths.slice(0, 3)) {
      console.log(`    ${p.path} (${p.count}x, avg score: ${p.avgScore.toFixed(0)})`);
    }
  }

  if (analysis.weaponPerformance.length > 0) {
    console.log('');
    console.log('  Weapon performance:');
    for (const w of analysis.weaponPerformance) {
      console.log(`    ${w.weapon}: ${w.count}x, avg score: ${w.avgScore.toFixed(0)}`);
    }
  }

  console.log('');
  console.log(`  Results:  ${OUTPUT_FILE}`);
  console.log(`  Summary:  ${SUMMARY_FILE}`);
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
  console.error('[batch-sim] FATAL:', err);
  process.exit(1);
});
