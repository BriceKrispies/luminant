import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

function getGitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: __dirname })
      .toString().trim();
  } catch {
    return 'unknown';
  }
}

/** True if there are uncommitted tracked changes. */
function isDirty() {
  try {
    execSync('git diff --quiet && git diff --cached --quiet', { cwd: __dirname });
    return false;
  } catch {
    return true;
  }
}

/**
 * Build version used to bust the service worker cache.
 *
 * Commit-hash-based: a new commit → new cache name → old cache purged on
 * activate, forcing fresh asset fetches (including trained-weights.json).
 * Same commit → same cache → stable offline experience.
 *
 * "-dirty" suffix when there are uncommitted tracked changes, so testing
 * local edits against a live SW doesn't get stuck on a stale cache.
 */
const BUILD_VERSION = `${getGitCommit()}${isDirty() ? '-dirty' : ''}`;

/** Vite plugin: stamp sw.js with a unique cache version on each build */
function swVersionPlugin() {
  return {
    name: 'sw-version',
    closeBundle() {
      const swPath = resolve(__dirname, 'dist', 'sw.js');
      try {
        let sw = readFileSync(swPath, 'utf8');
        sw = sw.replaceAll('__BUILD_HASH__', BUILD_VERSION);
        writeFileSync(swPath, sw);
      } catch { /* sw.js not in output — dev mode */ }
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  base: process.env.GITHUB_PAGES ? '/luminant/' : '/',
  plugins: [swVersionPlugin()],
  define: {
    __GIT_COMMIT__: JSON.stringify(BUILD_VERSION),
  },
  build: {
    outDir: 'dist',
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        lab: resolve(__dirname, 'lab/index.html'),
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  assetsInclude: ['**/*.wasm'],
  resolve: {
    alias: {
      '@engine': resolve(__dirname, 'src/engine'),
      '@systems': resolve(__dirname, 'src/systems'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@content': resolve(__dirname, 'src/content'),
      '@ui': resolve(__dirname, 'src/ui'),
      '@utils': resolve(__dirname, 'src/utils'),
    },
  },
});
