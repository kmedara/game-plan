/// <reference types="vitest/config" />
import angular from '@analogjs/vite-plugin-angular';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  plugins: [angular()],
  test: {
    globals: true,
    setupFiles: ['src/test-setup.ts'],
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/app/**/*.{ts,js}'],
      exclude: [
        'src/**/*.{spec,test}.ts',
        'src/testing/**',
        '**/types.ts',
      ],
      reporters: ['text', 'html'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
  define: {
    'import.meta.vitest': mode !== 'production',
  },
}));
