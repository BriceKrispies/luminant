/**
 * Simulation Lab CLI harness.
 * Orchestrates batch runs, evolution, replay, and analytics from the command line.
 *
 * Usage:
 *   node harness/simulation-lab.js [command] [options]
 *
 * Commands:
 *   batch       Run a batch of simulations (default)
 *   evolve      Run evolutionary search
 *   replay      Replay a stored run artifact
 *   compare     Compare two stored run artifacts
 *   analytics   Generate analytics from stored artifacts
 *
 * Options:
 *   --runs=N           Number of runs (batch, default: 10)
 *   --seed=N           Starting seed (default: random)
 *   --maxTicks=N       Max ticks per run (default: 30000)
 *   --bias=NAME        Add a bias preset (can repeat: --bias=survival --bias=xp_collection)
 *   --mutate           Enable mutation between runs
 *   --snapshots=N      Snapshot interval in ticks (default: 300)
 *   --output=DIR       Output directory (default: results/lab/)
 *   --silent           Suppress per-run output
 *   --pop=N            Population size (evolve, default: 8)
 *   --gens=N           Generations (evolve, default: 5)
 *   --runsPerConfig=N  Runs per config in evolution (default: 2)
 *   --artifact=PATH    Path to artifact file (replay/compare)
 *   --artifactB=PATH   Second artifact path (compare)
 *   --forced           Use forced upgrades in replay
 *   --input=DIR        Input directory for analytics
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadEngine } from '../src/engine/loader.js';
import { createBotConfig, serializeBotConfig } from '../src/lab/bot.js';
import { runLabBatch, runLabEvolution } from '../src/lab/lab-runner.js';
import { replayRun, replayWithForcedUpgrades } from '../src/lab/replay.js';
import { analyzeUpgrades, formatAnalyticsSummary } from '../src/lab/analytics.js';
import { deserializeArtifact } from '../src/lab/run-recorder.js';

// Register policies
import '../src/ai/policies/survival.js';
import '../src/ai/policies/progression.js';
import '../src/systems/player-ai/policies/coward.js';
import '../src/systems/player-ai/policies/kiter.js';
import '../src/systems/player-ai/policies/brawler.js';
import '../src/systems/player-ai/policies/farmer.js';
import '../src/ai/neural/neural-policy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function parseArgs(argv) {
  const result = { _: [] };
  for (const arg of argv) {
    const m = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (m) {
      const key = m[1];
      const val = m[2] !== undefined ? m[2] : true;
      if (result[key] && key === 'bias') {
        if (!Array.isArray(result[key])) result[key] = [result[key]];
        result[key].push(val);
      } else {
        result[key] = val;
      }
    } else {
      result._.push(arg);
    }
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || 'batch';

const OUTPUT_DIR = resolve(ROOT, args.output || 'results/lab');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

async function main() {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const wasm = await loadEngine();

  switch (command) {
    case 'batch': return runBatch(wasm);
    case 'evolve': return runEvolve(wasm);
    case 'replay': return runReplay(wasm);
    case 'compare': return runCompare();
    case 'analytics': return runAnalytics();
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

async function runBatch(wasm) {
  const runs = parseInt(args.runs) || 10;
  const startSeed = parseInt(args.seed) || Math.floor(Math.random() * 1000000);
  const maxTicks = parseInt(args.maxTicks) || 30000;
  const mutate = 'mutate' in args;
  const snapshotInterval = parseInt(args.snapshots) || 300;
  const silent = 'silent' in args;
  const biases = Array.isArray(args.bias) ? args.bias : (args.bias ? [args.bias] : []);

  const botConfig = createBotConfig({ name: 'lab-batch', biases });

  console.log('========================================');
  console.log('  SIMULATION LAB — BATCH');
  console.log('========================================');
  console.log(`  Runs:      ${runs}`);
  console.log(`  Seed:      ${startSeed}`);
  console.log(`  Biases:    ${biases.length > 0 ? biases.join(', ') : '(none)'}`);
  console.log(`  Mutate:    ${mutate}`);
  console.log(`  Max ticks: ${maxTicks}`);
  console.log(`  Output:    ${OUTPUT_DIR}`);
  console.log('========================================\n');

  const startTime = performance.now();

  const { artifacts, analytics, lineage, summary } = await runLabBatch({
    runs,
    botConfig,
    startSeed,
    maxTicks,
    mutate,
    snapshotInterval,
    wasm,
    silent,
    onRun(i, artifact) {
      if (!silent) {
        const s = artifact.summary;
        console.log(
          `Run ${i + 1}/${runs} | ` +
          `T=${s.survivalTime.toFixed(0)}s L${s.level} K${s.kills} W${s.wave} ` +
          `R=${artifact.reward?.total?.toFixed(0) || '?'} ` +
          `${s.survived ? 'ALIVE' : 'DEAD'}`
        );
      }
    },
  });

  const elapsed = (performance.now() - startTime) / 1000;

  // Write artifacts
  const artifactsFile = join(OUTPUT_DIR, `batch-${timestamp}.jsonl`);
  const lines = artifacts.map(a => JSON.stringify(a)).join('\n');
  writeFileSync(artifactsFile, lines + '\n');

  // Write analytics
  const analyticsFile = join(OUTPUT_DIR, `batch-${timestamp}-analytics.json`);
  writeFileSync(analyticsFile, JSON.stringify(analytics, null, 2));

  // Write lineage
  const lineageFile = join(OUTPUT_DIR, `batch-${timestamp}-lineage.json`);
  writeFileSync(lineageFile, JSON.stringify(lineage.serialize(), null, 2));

  // Write summary
  const summaryFile = join(OUTPUT_DIR, `batch-${timestamp}-summary.json`);
  writeFileSync(summaryFile, JSON.stringify({ ...summary, config: { runs, startSeed, maxTicks, mutate, biases } }, null, 2));

  console.log(`\n${formatAnalyticsSummary(analytics)}`);

  console.log('\n========================================');
  console.log('  BATCH SUMMARY');
  console.log('========================================');
  console.log(`  Runs:           ${summary.runs}`);
  console.log(`  Avg reward:     ${summary.avgReward.toFixed(1)}`);
  console.log(`  Best reward:    ${summary.bestReward.toFixed(1)}`);
  console.log(`  Avg score:      ${summary.avgScore.toFixed(1)}`);
  console.log(`  Avg survival:   ${summary.avgSurvivalTime.toFixed(1)}s`);
  console.log(`  Survival rate:  ${(summary.survivalRate * 100).toFixed(0)}%`);
  console.log(`  Time:           ${elapsed.toFixed(1)}s`);
  console.log('');
  console.log(`  Artifacts:  ${artifactsFile}`);
  console.log(`  Analytics:  ${analyticsFile}`);
  console.log(`  Lineage:    ${lineageFile}`);
  console.log('========================================');
}

async function runEvolve(wasm) {
  const populationSize = parseInt(args.pop) || 8;
  const generations = parseInt(args.gens) || 5;
  const runsPerConfig = parseInt(args.runsPerConfig) || 2;
  const maxTicks = parseInt(args.maxTicks) || 18000;
  const startSeed = parseInt(args.seed) || Math.floor(Math.random() * 1000000);
  const biases = Array.isArray(args.bias) ? args.bias : (args.bias ? [args.bias] : []);

  const botConfig = createBotConfig({ name: 'lab-evolve', biases });

  console.log('========================================');
  console.log('  SIMULATION LAB — EVOLUTION');
  console.log('========================================');
  console.log(`  Population: ${populationSize}`);
  console.log(`  Generations: ${generations}`);
  console.log(`  Runs/config: ${runsPerConfig}`);
  console.log(`  Biases:      ${biases.length > 0 ? biases.join(', ') : '(none)'}`);
  console.log(`  Max ticks:   ${maxTicks}`);
  console.log('========================================\n');

  const startTime = performance.now();

  const { bestConfig, bestReward, artifacts, analytics, lineage, history } = await runLabEvolution({
    botConfig,
    populationSize,
    generations,
    runsPerConfig,
    startSeed,
    maxTicks,
    wasm,
    onGeneration(gen, best) {
      const s = best.summary;
      console.log(
        `Gen ${gen}: best R=${best.reward?.total?.toFixed(0) || '?'} ` +
        `T=${s.survivalTime.toFixed(0)}s L${s.level} K${s.kills}`
      );
    },
  });

  const elapsed = (performance.now() - startTime) / 1000;

  // Write outputs
  const artifactsFile = join(OUTPUT_DIR, `evolve-${timestamp}.jsonl`);
  writeFileSync(artifactsFile, artifacts.map(a => JSON.stringify(a)).join('\n') + '\n');

  const resultFile = join(OUTPUT_DIR, `evolve-${timestamp}-result.json`);
  writeFileSync(resultFile, JSON.stringify({
    bestConfig: serializeBotConfig(bestConfig),
    bestReward,
    history,
    analytics,
  }, null, 2));

  const lineageFile = join(OUTPUT_DIR, `evolve-${timestamp}-lineage.json`);
  writeFileSync(lineageFile, JSON.stringify(lineage.serialize(), null, 2));

  console.log(`\n${formatAnalyticsSummary(analytics)}`);
  console.log(`\nBest reward: ${bestReward.toFixed(1)}`);
  console.log(`Time: ${elapsed.toFixed(1)}s`);
  console.log(`Results: ${resultFile}`);
}

async function runReplay(wasm) {
  const artifactPath = args.artifact;
  if (!artifactPath) {
    console.error('--artifact=PATH required for replay');
    process.exit(1);
  }

  const raw = readFileSync(resolve(ROOT, artifactPath), 'utf-8');
  // Support JSONL (take first line) or plain JSON
  const firstLine = raw.trim().split('\n')[0];
  const artifact = deserializeArtifact(firstLine);

  console.log(`Replaying run ${artifact.runId} (seed=${artifact.seed})...`);

  const fn = args.forced ? replayWithForcedUpgrades : replayRun;
  const { result, verification } = await fn(artifact, { wasm });

  console.log(`\nVerification: ${verification.match ? 'MATCH' : 'DIVERGED'}`);
  console.log(verification.note);
  if (!verification.match) {
    for (const [key, val] of Object.entries(verification.diffs)) {
      if (typeof val === 'object' && val.diff !== undefined && val.diff !== 0) {
        console.log(`  ${key}: original=${val.original} replay=${val.replay} diff=${val.diff}`);
      }
    }
  }

  console.log(`\nReplay: T=${result.survivalTime.toFixed(0)}s L${result.level} K${result.kills} W${result.wave}`);
}

async function runCompare() {
  const pathA = args.artifact;
  const pathB = args.artifactB;
  if (!pathA || !pathB) {
    console.error('--artifact=PATH and --artifactB=PATH required for compare');
    process.exit(1);
  }

  const { compareRuns } = await import('../src/lab/replay.js');
  const artA = deserializeArtifact(readFileSync(resolve(ROOT, pathA), 'utf-8').trim().split('\n')[0]);
  const artB = deserializeArtifact(readFileSync(resolve(ROOT, pathB), 'utf-8').trim().split('\n')[0]);

  const comparison = compareRuns(artA, artB);

  console.log('========================================');
  console.log('  RUN COMPARISON');
  console.log('========================================');
  console.log(`  Run A: ${comparison.runIdA}`);
  console.log(`  Run B: ${comparison.runIdB}`);
  console.log(`  Winner: ${comparison.winner}`);
  console.log('');
  for (const [key, val] of Object.entries(comparison.comparison)) {
    if (key === 'upgradePath' || key === 'reward') continue;
    console.log(`  ${key}: A=${val.a} B=${val.b} (${val.pctDiff >= 0 ? '+' : ''}${val.pctDiff}%)`);
  }
  console.log('========================================');
}

async function runAnalytics() {
  const inputDir = resolve(ROOT, args.input || args.output || 'results/lab');
  if (!existsSync(inputDir)) {
    console.error(`Input directory not found: ${inputDir}`);
    process.exit(1);
  }

  // Load all JSONL artifact files
  const files = readdirSync(inputDir).filter(f => f.endsWith('.jsonl'));
  const artifacts = [];

  for (const file of files) {
    const content = readFileSync(join(inputDir, file), 'utf-8');
    for (const line of content.trim().split('\n')) {
      if (line.trim()) {
        artifacts.push(deserializeArtifact(line));
      }
    }
  }

  if (artifacts.length === 0) {
    console.log('No artifacts found.');
    return;
  }

  const analytics = analyzeUpgrades(artifacts);
  console.log(formatAnalyticsSummary(analytics));

  const outFile = join(OUTPUT_DIR, `analytics-${timestamp}.json`);
  writeFileSync(outFile, JSON.stringify(analytics, null, 2));
  console.log(`\nFull report: ${outFile}`);
}

main().catch(err => {
  console.error('[simulation-lab] FATAL:', err);
  process.exit(1);
});
