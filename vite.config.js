import { defineConfig } from 'vite';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  base: process.env.GITHUB_PAGES ? '/luminant/' : '/',
  build: {
    outDir: 'dist',
    target: 'esnext',
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
