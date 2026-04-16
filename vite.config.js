import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

/** Vite plugin: stamp sw.js with a unique cache version on each build */
function swVersionPlugin() {
  return {
    name: 'sw-version',
    closeBundle() {
      const swPath = resolve(__dirname, 'dist', 'sw.js');
      try {
        let sw = readFileSync(swPath, 'utf8');
        const hash = createHash('md5')
          .update(Date.now().toString())
          .digest('hex')
          .slice(0, 8);
        sw = sw.replaceAll('__BUILD_HASH__', hash);
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
