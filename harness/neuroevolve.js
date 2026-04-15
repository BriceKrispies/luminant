/**
 * Neuroevolution training harness.
 * Evolves neural network weights via population-based search using headless game simulations.
 *
 * Usage:
 *   node harness/neuroevolve.js [options]
 *
 * Options:
 *   --pop=N          Population size (default: 50)
 *   --gens=N         Number of generations (default: 100)
 *   --runs=N         Games per individual per generation (default: 3)
 *   --maxTicks=N     Max ticks per game (default: 30000)
 *   --seed=N         Base seed (default: 42)
 *   --eliteRate=F    Fraction of population kept as elites (default: 0.2)
 *   --mutRate=F      Per-weight mutation probability (default: 0.1)
 *   --mutScale=F     Mutation gaussian std dev (default: 0.3)
 *   --workers=N      Worker thread count (default: cpus - 1)
 *   --output=PATH    Output file (default: results/neuro-<timestamp>.json)
 *   --resume=PATH    Resume from checkpoint JSON
 */

import { Worker } from 'worker_threads';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { availableParallelism } from 'os';
import { FeedforwardNetwork } from '../src/ai/neural/feedforward.js';
import { INPUT_SIZE } from '../src/ai/neural/encode.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Parse args ──
const args = parseArgs(process.argv.slice(2));
const POP = parseInt(args.pop) || 50;
const GENS = parseInt(args.gens) || 100;
const RUNS = parseInt(args.runs) || 3;
const MAX_TICKS = parseInt(args.maxTicks) || 30000;
const SEED = parseInt(args.seed) || 42;
const ELITE_RATE = parseFloat(args.eliteRate) || 0.2;
const MUT_RATE = parseFloat(args.mutRate) || 0.1;
const MUT_SCALE = parseFloat(args.mutScale) || 0.3;
const NUM_WORKERS = parseInt(args.workers) || Math.max(1, availableParallelism() - 1);
const TOPOLOGY = [INPUT_SIZE, 32, 16, 4];

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUTPUT_DIR = resolve(ROOT, 'results');
const OUTPUT_FILE = args.output
  ? resolve(ROOT, args.output)
  : resolve(OUTPUT_DIR, `neuro-${timestamp}.json`);
const WEIGHTS_FILE = resolve(ROOT, 'src', 'ai', 'neural', 'trained-weights.json');

// ── PRNG ──
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianRandom(rng) {
  let u, v, s;
  do {
    u = rng() * 2 - 1;
    v = rng() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  return u * Math.sqrt(-2 * Math.log(s) / s);
}

// ── Genome operations ──
function randomGenome(rng, size) {
  const g = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    g[i] = gaussianRandom(rng) * 0.1;
  }
  return g;
}

function mutateGenome(parent, rate, scale, rng) {
  const child = new Float32Array(parent.length);
  for (let i = 0; i < parent.length; i++) {
    child[i] = parent[i] + (rng() < rate ? gaussianRandom(rng) * scale : 0);
  }
  return child;
}

// ── Worker pool ──
function createWorkerPool(count) {
  const workerPath = resolve(__dirname, 'neuro-worker.js');
  const workers = [];
  const pending = new Map();
  let nextId = 0;

  for (let i = 0; i < count; i++) {
    const w = new Worker(workerPath);
    w.on('message', (msg) => {
      if (msg.type === 'ready') return;
      if (msg.type === 'result' || msg.type === 'error') {
        const cb = pending.get(msg.id);
        if (cb) {
          pending.delete(msg.id);
          if (msg.type === 'error') {
            cb.reject(new Error(msg.error));
          } else {
            cb.resolve(msg.fitness);
          }
        }
      }
    });
    workers.push(w);
  }

  return {
    async init() {
      await Promise.all(workers.map(w =>
        new Promise((resolve) => {
          w.once('message', (msg) => {
            if (msg.type === 'ready') resolve();
          });
          w.postMessage({ type: 'init' });
        })
      ));
    },

    evaluate(genome, seeds, maxTicks) {
      const id = nextId++;
      const workerIdx = id % workers.length;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        workers[workerIdx].postMessage({
          type: 'evaluate',
          id,
          genome: Array.from(genome),
          seeds,
          maxTicks,
        });
      });
    },

    terminate() {
      for (const w of workers) w.terminate();
    },
  };
}

// ── Main training loop ──
async function run() {
  console.log('========================================');
  console.log('  LUMINANT NEUROEVOLUTION');
  console.log('========================================');
  console.log(`  Topology:    ${TOPOLOGY.join(' → ')}`);
  console.log(`  Population:  ${POP}`);
  console.log(`  Generations: ${GENS}`);
  console.log(`  Runs/eval:   ${RUNS}`);
  console.log(`  Max ticks:   ${MAX_TICKS}`);
  console.log(`  Curriculum:  ${MAX_TICKS * 0.2} → ${MAX_TICKS} ticks (ramps over 40% of gens)`);
  console.log(`  Seed:        ${SEED}`);
  console.log(`  Elite rate:  ${ELITE_RATE}`);
  console.log(`  Mut rate:    ${MUT_RATE}`);
  console.log(`  Mut scale:   ${MUT_SCALE}`);
  console.log(`  Workers:     ${NUM_WORKERS}`);
  console.log(`  Output:      ${OUTPUT_FILE}`);
  console.log('========================================\n');

  const net = new FeedforwardNetwork(TOPOLOGY);
  const genomeSize = net.weightCount;
  console.log(`  Genome size: ${genomeSize} weights\n`);

  const rng = mulberry32(SEED);

  // Initialize or resume population
  let population;
  let startGen = 0;
  const history = [];

  if (args.resume) {
    const checkpoint = JSON.parse(readFileSync(resolve(ROOT, args.resume), 'utf-8'));
    population = checkpoint.population.map(g => new Float32Array(g));
    startGen = checkpoint.generation + 1;
    history.push(...checkpoint.history);
    console.log(`  Resumed from gen ${startGen}, ${population.length} genomes\n`);
  } else {
    population = [];
    for (let i = 0; i < POP; i++) {
      population.push(randomGenome(rng, genomeSize));
    }
  }

  // Start worker pool
  const pool = createWorkerPool(NUM_WORKERS);
  await pool.init();
  console.log(`  Workers initialized (${NUM_WORKERS})\n`);

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const eliteCount = Math.max(1, Math.ceil(POP * ELITE_RATE));
  let bestEverFitness = -Infinity;
  let bestEverGenome = null;
  const startTime = performance.now();

  // Curriculum: ramp game length from 20% to 100% of maxTicks over first 40% of gens.
  // Early gens use short games (learn basics fast), later gens use full length (learn snowballing).
  const CURRICULUM_END = Math.floor(GENS * 0.4);
  const MIN_TICKS = Math.floor(MAX_TICKS * 0.2);
  function curriculumTicks(gen) {
    if (gen >= CURRICULUM_END) return MAX_TICKS;
    const t = gen / CURRICULUM_END; // 0 → 1
    return Math.floor(MIN_TICKS + (MAX_TICKS - MIN_TICKS) * t * t); // quadratic ramp
  }

  for (let gen = startGen; gen < GENS; gen++) {
    const genStart = performance.now();
    const genTicks = curriculumTicks(gen);

    // Seeds for this generation (same for all individuals, different across gens)
    const seeds = [];
    for (let r = 0; r < RUNS; r++) {
      seeds.push(SEED + gen * 1000 + r);
    }

    // Evaluate all genomes in parallel via worker pool
    const fitnessPromises = population.map(genome =>
      pool.evaluate(genome, seeds, genTicks)
    );
    const fitnesses = await Promise.all(fitnessPromises);

    // Sort by fitness descending
    const indexed = fitnesses.map((f, i) => ({ fitness: f, index: i }));
    indexed.sort((a, b) => b.fitness - a.fitness);

    const best = indexed[0].fitness;
    const worst = indexed[indexed.length - 1].fitness;
    const median = indexed[Math.floor(indexed.length / 2)].fitness;
    const genTime = ((performance.now() - genStart) / 1000).toFixed(1);

    history.push({ generation: gen, best, median, worst, ticks: genTicks });

    if (best > bestEverFitness) {
      bestEverFitness = best;
      bestEverGenome = new Float32Array(population[indexed[0].index]);
    }

    console.log(
      `  Gen ${gen + 1}/${GENS} [${genTicks}t]: ` +
      `best=${best.toFixed(0)} median=${median.toFixed(0)} worst=${worst.toFixed(0)} ` +
      `(${genTime}s)`
    );

    // Selection + mutation
    const newPop = [];

    // Keep elites unchanged
    for (let i = 0; i < eliteCount; i++) {
      newPop.push(new Float32Array(population[indexed[i].index]));
    }

    // Fill rest by mutating random elites
    while (newPop.length < POP) {
      // Every 10 gens, inject 2 fully random genomes to escape local optima
      if (gen > 0 && gen % 10 === 0 && newPop.length >= POP - 2) {
        newPop.push(randomGenome(rng, genomeSize));
        continue;
      }
      const parentIdx = Math.floor(rng() * eliteCount);
      const parent = newPop[parentIdx];
      newPop.push(mutateGenome(parent, MUT_RATE, MUT_SCALE, rng));
    }

    population = newPop;

    // Checkpoint every 10 generations
    if ((gen + 1) % 10 === 0) {
      const checkpoint = {
        generation: gen,
        population: population.map(g => Array.from(g)),
        bestFitness: bestEverFitness,
        bestGenome: Array.from(bestEverGenome),
        history,
        config: { topology: TOPOLOGY, pop: POP, gens: GENS, runs: RUNS, maxTicks: MAX_TICKS, seed: SEED, eliteRate: ELITE_RATE, mutRate: MUT_RATE, mutScale: MUT_SCALE },
      };
      const cpFile = resolve(OUTPUT_DIR, `neuro-checkpoint-gen${gen + 1}.json`);
      writeFileSync(cpFile, JSON.stringify(checkpoint));
      console.log(`  [checkpoint saved: ${cpFile}]`);
    }
  }

  pool.terminate();

  const totalTime = ((performance.now() - startTime) / 1000).toFixed(1);

  // Save final result
  const finalNet = new FeedforwardNetwork(TOPOLOGY);
  finalNet.setWeights(bestEverGenome);

  const output = {
    version: 1,
    topology: TOPOLOGY,
    weights: Array.from(bestEverGenome),
    fitness: bestEverFitness,
    config: {
      pop: POP, gens: GENS, runs: RUNS, maxTicks: MAX_TICKS, seed: SEED,
      eliteRate: ELITE_RATE, mutRate: MUT_RATE, mutScale: MUT_SCALE,
    },
    history,
    timestamp: new Date().toISOString(),
    totalTimeSeconds: parseFloat(totalTime),
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  writeFileSync(WEIGHTS_FILE, JSON.stringify(output, null, 2));

  console.log('\n========================================');
  console.log('  NEUROEVOLUTION RESULTS');
  console.log('========================================');
  console.log(`  Best fitness: ${bestEverFitness.toFixed(0)}`);
  console.log(`  Total time:   ${totalTime}s`);
  console.log(`  Output:       ${OUTPUT_FILE}`);
  console.log(`  Weights:      ${WEIGHTS_FILE}`);
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
  console.error('[neuroevolve] FATAL:', err);
  process.exit(1);
});
