import { defineConfig } from '@playwright/test';

// Visual regression + DOM-level browser tests.
// Lives alongside vitest — vitest runs `tests/**/*.test.ts`, Playwright runs
// `tests/**/*.spec.ts`. Scripts scope e2e and visual suites separately.
//
// These tests launch the built CLI with an isolated PLAN_REVIEW_HOME, point
// headless Chromium at it, and assert behavior, renderer DOM and styles.
// Run: `npm run test:visual`.
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/visual/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
