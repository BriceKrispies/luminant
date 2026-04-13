import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
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
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    globals: true,
    testTimeout: 30000,
  },
});
