import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environmentMatchGlobs: [
      ['tests/browser/**', 'jsdom'],
    ],
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
});
