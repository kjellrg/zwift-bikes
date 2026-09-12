import { defineConfig } from '@playwright/test'

/**
 * The browser journeys under `tests/browser/` - complete page flows through
 * the real app (issue #201's test boundary), asserting what a rider or a
 * crawler sees rather than component internals. They drive the dev server,
 * which Playwright starts here unless one is already listening on the port:
 * a cold `nuxt dev` compiles the first route page in ~20 s and a recommend
 * request takes several seconds, which is why every timeout below is
 * generous. Not part of `npm test` (the vitest suite stays plain-node and
 * fast) and not run in CI yet - `npm run test:browser` by hand, and never
 * alongside `npm run typecheck` or `npm run build` on a small machine.
 */
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3010)
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: 'tests/browser',
  outputDir: 'test-results',
  fullyParallel: false,
  // One worker: the dev server and the recommend endpoints are CPU-bound,
  // and two journeys racing each other only produce timeouts.
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 60_000 },
  reporter: [['list']],
  use: {
    baseURL,
    headless: true,
    // Each test gets a fresh browser context, so localStorage starts empty:
    // the profile, garage and preferences are the composable defaults unless
    // a test seeds them itself.
    storageState: undefined,
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe'
  }
})
