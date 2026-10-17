/**
 * Vitest configuration for the monorepo.
 *
 * Tests live next to area functions, the local adapter, client packages, and infrastructure helpers.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Project root using the same drive-letter case as this process.
 * Forcing `C:` makes Vite load modules on a different id than vi.mock, and the
 * untested-file coverage pass then records a second copy of every file.
 */
const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)));

export default defineConfig({
  root,
  resolve: {
    preserveSymlinks: false,
  },
  test: {
    environment: 'node',
    env: { AUTH_PROVIDER: 'local', LOCAL_JWT_SECRET: 'vitest-local-secret' },
    pool: 'forks',
    // Single-worker runs avoid flaky coverage.tmp ENOENT races on Windows.
    fileParallelism: false,
    maxWorkers: 1,
    include: [
      'functions/**/*.test.ts',
      'local/**/*.test.ts',
      'client/session/**/*.test.ts',
      'lib/**/*.test.ts',
      'infrastructure/lib/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      // A lowercase Git Bash cwd and Windows realpath `C:` otherwise count every file twice.
      all: process.platform !== 'win32' || /^[A-Z]:/.test(process.cwd()),
      reportsDirectory: path.join(root, 'coverage'),
      include: ['functions/**/*.ts'],
      exclude: [
        'functions/**/*.test.ts',
        'functions/**/local.ts',
      ],
      reporter: ['text', 'html', 'json'],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
