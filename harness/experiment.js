/**
 * Experiment CLI harness.
 * Runs structured experiments with evolutionary training from the command line.
 *
 * Usage:
 *   node harness/experiment.js [command] [options]
 *
 * Commands:
 *   run         Run an experiment from config file or inline params (default)
 *   evaluate    Evaluate a single bot config across seeds
 *   analyze     Run population analysis on experiment artifacts
 *   compare     Compare generation winners from an experiment
 *
 * Options:
 *   --name=NAME          Experiment name
 *   --pop=N              Population size (default: 10)
 *   --gens=N             Generations (default: 10)
 *   --runs=N             Runs per candidate (default: 3)
 *   --elites=N           Elite count (default: 3)
 *   --maxTicks=N         Max ticks per run (default: 18000)
 *   --seed=N             Starting seed (default: 1)
 *   --bias=NAME          Bias preset (can repeat)
 *   --mutRate=FLOAT      Mutation rate (default: 0.3)
 *   --mutScale=FLOAT     Mutation scale (default: 0.15)
 *   --detail=LEVEL       Trajectory detail: summary|moments|sampled|full (default: moments)
 *   --output=DIR         Output directory (default: artifacts/)
 *   --config=PATH        Path to experiment config JSON
 *   --input=PATH         Input artifact for analyze/compare
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadEngine } from '../src/engine/loader.js';
import { createBotConfig, serializeBotConfig } from '../src/lab/bot.js';
import { createExperimentConfig } from '../src/lab/experiment.js';
import { runExperiment, evaluateConfig } from '../src/lab/experiment-runner.js';
import { fullPopulationAnalysis } from '../src/lab/population-analysis.js';
import { compareGenerationWinners } from '../src/lab/replay.js';

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
const command = args._[0] || 'run';

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

async function main() {
  switch (command) {
    case 'run': return runExperimentCmd();
    case 'evaluate': return runEvaluateCmd();
    case 'analyze': return runAnalyzeCmd();
    case 'compare': return runCompareCmd();
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

async function runExperimentCmd() {
  const wasm = await loadEngine();

  let config;

  if (args.config) {
    // Load config from JSON file
    const raw = readFileSync(resolve(ROOT, args.config), 'utf-8');
    config = JSON.parse(raw);
  } else {
    // Build config from CLI args
    const biases = Array.isArray(args.bias) ? args.bias : (args.bias ? [args.bias] : []);
    const name = args.name || `experiment-${timestamp}`;

    config = createExperimentConfig({
      name,
      policyFamily: 'lab-bot',
      basePolicyParams: { biases },
      training: {
        populationSize: parseInt(args.pop) || 10,
        generations: parseInt(args.gens) || 10,
        runsPerCandidate: parseInt(args.runs) || 3,
        eliteCount: parseInt(args.elites) || 3,
        mutationRate: parseFloat(args.mutRate) || 0.3,
        mutationScale: parseFloat(args.mutScale) || 0.15,
        maxTicks: parseInt(args.maxTicks) || 18000,
      },
      seedStrategy: {
        type: 'sequential',
        startSeed: parseInt(args.seed) || 1,
      },
      trajectoryDetail: args.detail || 'moments',
      artifactSettings: {
        outputDir: args.output || 'artifacts',
      },
    });
  }

  const outputDir = resolve(ROOT, config.artifacts?.outputDir || args.output || 'artifacts');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  console.log('========================================');
  console.log('  EXPERIMENT RUNNER');
  console.log('========================================');
  console.log(`  Name:       ${config.name}`);
  console.log(`  ID:         ${config.id}`);
  console.log(`  Policy:     ${config.policyFamily}`);
  console.log(`  Population: ${config.training.populationSize}`);
  console.log(`  Generations: ${config.training.generations}`);
  console.log(`  Runs/cand:  ${config.training.runsPerCandidate}`);
  console.log(`  Elites:     ${config.training.eliteCount}`);
  console.log(`  Max ticks:  ${config.training.maxTicks}`);
  console.log(`  Detail:     ${config.trajectoryDetail}`);
  console.log(`  Output:     ${outputDir}`);
  console.log('========================================\n');

  const startTime = performance.now();

  const result = await runExperiment(config, {
    wasm,
    onGeneration(gen, artifact) {
      const s = artifact.stats;
      console.log(
        `Gen ${gen + 1}/${config.training.generations} | ` +
        `best=${s.bestReward.toFixed(1)} ` +
        `median=${s.medianReward.toFixed(1)} ` +
        `worst=${s.worstReward.toFixed(1)} ` +
        `diversity=${(s.diversity || 0).toFixed(3)}`
      );
    },
    onProgress(msg) {
      console.log(`[progress] ${msg}`);
    },
  });

  const elapsed = (performance.now() - startTime) / 1000;

  // Write experiment summary
  const summaryFile = join(outputDir, `${config.id}-summary.json`);
  writeFileSync(summaryFile, JSON.stringify(result.experimentSummary, null, 2));

  // Write generation artifacts
  const gensFile = join(outputDir, `${config.id}-generations.jsonl`);
  writeFileSync(gensFile, result.generations.map(g => JSON.stringify(g)).join('\n') + '\n');

  // Write run artifacts
  const runsFile = join(outputDir, `${config.id}-runs.jsonl`);
  writeFileSync(runsFile, result.artifacts.map(a => JSON.stringify(a)).join('\n') + '\n');

  // Write best config
  const bestFile = join(outputDir, `${config.id}-best.json`);
  writeFileSync(bestFile, JSON.stringify(serializeBotConfig(result.bestConfig), null, 2));

  // Write lineage
  const lineageFile = join(outputDir, `${config.id}-lineage.json`);
  writeFileSync(lineageFile, JSON.stringify(result.lineage.serialize(), null, 2));

  console.log('\n========================================');
  console.log('  EXPERIMENT COMPLETE');
  console.log('========================================');
  console.log(`  Best reward:   ${result.bestReward.toFixed(1)}`);
  console.log(`  Total runs:    ${result.artifacts.length}`);
  console.log(`  Time:          ${elapsed.toFixed(1)}s`);
  console.log(`  Summary:       ${summaryFile}`);
  console.log(`  Best config:   ${bestFile}`);
  console.log(`  Generations:   ${gensFile}`);
  console.log(`  Runs:          ${runsFile}`);
  console.log('========================================');
}

async function runEvaluateCmd() {
  const wasm = await loadEngine();
  const biases = Array.isArray(args.bias) ? args.bias : (args.bias ? [args.bias] : []);
  const botConfig = createBotConfig({ name: 'eval-bot', biases });

  const seedCount = parseInt(args.runs) || 5;
  const startSeed = parseInt(args.seed) || 1;
  const seeds = Array.from({ length: seedCount }, (_, i) => startSeed + i);

  console.log(`Evaluating config across ${seedCount} seeds...`);

  const { avgReward, results } = await evaluateConfig({
    botConfig,
    seeds,
    maxTicks: parseInt(args.maxTicks) || 18000,
    wasm,
  });

  for (const r of results) {
    const s = r.result;
    console.log(
      `  Seed ${r.seed}: R=${r.reward.total.toFixed(1)} ` +
      `T=${s.survivalTime.toFixed(0)}s L${s.level} K${s.kills}`
    );
  }

  console.log(`\nAverage reward: ${avgReward}`);
}

async function runAnalyzeCmd() {
  const inputPath = args.input;
  if (!inputPath) {
    console.error('--input=PATH required (experiment summary or generations JSONL)');
    process.exit(1);
  }

  const raw = readFileSync(resolve(ROOT, inputPath), 'utf-8');

  // Try to parse as generations JSONL
  const lines = raw.trim().split('\n');
  const generations = lines.map(l => JSON.parse(l)).filter(g => g.type === 'generation');

  if (generations.length === 0) {
    console.error('No generation artifacts found in input.');
    process.exit(1);
  }

  const analysis = fullPopulationAnalysis({ generations, allRuns: [] });

  console.log('========================================');
  console.log('  POPULATION ANALYSIS');
  console.log('========================================');

  if (analysis.convergence) {
    console.log(`\n  Convergence: ${analysis.convergence.trend}`);
    console.log(`  Best slope: ${analysis.convergence.bestSlope}`);
    console.log(`  Diversity collapse: ${analysis.convergence.diversityCollapse}`);
  }

  if (analysis.parameterCorrelation.length > 0) {
    console.log('\n  Top parameter correlations:');
    for (const p of analysis.parameterCorrelation.slice(0, 10)) {
      console.log(`    ${p.key}: r=${p.correlation} (${p.direction})`);
    }
  }

  console.log('========================================');

  const outputDir = resolve(ROOT, args.output || 'artifacts');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const outFile = join(outputDir, `analysis-${timestamp}.json`);
  writeFileSync(outFile, JSON.stringify(analysis, null, 2));
  console.log(`\nFull analysis: ${outFile}`);
}

async function runCompareCmd() {
  const inputPath = args.input;
  if (!inputPath) {
    console.error('--input=PATH required (generations JSONL)');
    process.exit(1);
  }

  const raw = readFileSync(resolve(ROOT, inputPath), 'utf-8');
  const lines = raw.trim().split('\n');
  const generations = lines.map(l => JSON.parse(l)).filter(g => g.type === 'generation');

  const { winners, improvements } = compareGenerationWinners(generations);

  console.log('========================================');
  console.log('  GENERATION WINNERS');
  console.log('========================================');
  for (const w of winners) {
    console.log(`  Gen ${w.generation}: ${w.name} R=${w.avgReward.toFixed(1)}`);
  }

  console.log('\n  Improvements:');
  for (const imp of improvements) {
    console.log(
      `    Gen ${imp.fromGen} → ${imp.toGen}: ` +
      `${imp.improved ? '+' : ''}${imp.rewardDelta.toFixed(1)} ` +
      `${imp.improved ? '(improved)' : '(regressed)'}`
    );
  }
  console.log('========================================');
}

main().catch(err => {
  console.error('[experiment] FATAL:', err);
  process.exit(1);
});
