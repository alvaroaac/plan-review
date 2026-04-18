import { defineConfig } from '@playwright/test';

// Visual regression + DOM-level browser tests.
// Lives alongside vitest — vitest runs `tests/**/*.test.ts`, Playwright runs
// `tests/visual/**/*.spec.ts`. No overlap.
//
// These tests boot the real `HttpTransport` in-process (same pattern as
// tests/browser-integration.test.ts), point a headless Chromium at it, and
// assert the post-mount DOM + computed styles that unit tests can't reach.
//
// Run: `npm run test:visual`.
export default defineConfig({
  testDir: './tests/visual',
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
