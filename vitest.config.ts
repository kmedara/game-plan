/**
 * Vitest configuration for the monorepo.
 *
 * Tests live next to area functions, the local adapter, and client packages.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'functions/**/*.test.ts',
      'local/**/*.test.ts',
      'client/**/*.test.ts',
      'lib/**/*.test.ts',
    ],
  },
});
