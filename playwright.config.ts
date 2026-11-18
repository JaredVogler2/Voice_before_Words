import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end checks against the production build, in real browsers.
 * Run `npm run build` first; `npm run test:e2e` then serves `dist/` and drives it.
 *
 * Chromium always runs. Firefox and WebKit (the engine behind every browser on
 * iPhone and iPad) run too when E2E_ALL is set, as it is in CI.
 */
const everyBrowser = !!process.env.E2E_ALL;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    // The service worker would cache one build while the next is being tested.
    serviceWorkers: 'block',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          // A made-up camera picture, so the camera test needs no hardware and no permission prompt.
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
    },
    ...(everyBrowser
      ? [
          { name: 'firefox', use: { browserName: 'firefox' as const } },
          { name: 'webkit', use: { browserName: 'webkit' as const, userAgent: devices['iPhone 14'].userAgent } },
        ]
      : []),
  ],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
