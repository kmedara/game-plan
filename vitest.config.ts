/**
 * Vitest configuration for the monorepo.
 *
 * Tests live next to area functions, the local adapter, and client packages.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Canonical project root with an uppercase drive letter on Windows (avoids c: vs C: coverage doubles). */
const root = path
  .resolve(fileURLToPath(new URL('.', import.meta.url)))
  .replace(/^([a-z]):/, (_match, drive: string) => `${drive.toUpperCase()}:`);

export default defineConfig({
  root,
  resolve: {
    // Keep module ids aligned with the uppercase root on Windows.
    preserveSymlinks: false,
  },
  test: {
    environment: 'node',
    pool: 'forks',
    // Single-worker runs avoid flaky coverage.tmp ENOENT races on Windows.
    fileParallelism: false,
    maxWorkers: 1,
    include: [
      'functions/**/*.test.ts',
      'local/**/*.test.ts',
      'client/session/**/*.test.ts',
      'lib/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: path.join(root, 'coverage'),
      include: ['functions/**/*.ts'],
      exclude: [
        'functions/**/*.test.ts',
        'functions/**/local.ts',
      ],
      reporters: ['text', 'html', 'json'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
