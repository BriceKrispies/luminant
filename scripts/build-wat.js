/**
 * Compiles engine/core.wat → public/core.wasm using wabt.
 * Run with: node scripts/build-wat.js
 */
import wabt from 'wabt';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

async function build() {
  const watPath = resolve(ROOT, 'engine/core.wat');
  const outDir = resolve(ROOT, 'public');
  const outPath = resolve(outDir, 'core.wasm');

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const source = readFileSync(watPath, 'utf-8');
  const wabtModule = await wabt();
  const parsed = wabtModule.parseWat('core.wat', source);
  parsed.validate();
  const { buffer } = parsed.toBinary({ write_debug_names: true });

  writeFileSync(outPath, Buffer.from(buffer));
  console.log(`[build-wat] ${watPath} → ${outPath} (${buffer.byteLength} bytes)`);
}

build().catch((err) => {
  console.error('[build-wat] FAILED:', err.message);
  process.exit(1);
});
