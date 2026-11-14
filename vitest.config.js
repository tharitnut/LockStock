import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.js'],
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
