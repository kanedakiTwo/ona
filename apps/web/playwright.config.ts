import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for the ONA web E2E suite.
 *
 * The API + Web servers must be running on the URLs below before the suite
 * starts. The orchestration script `apps/web/scripts/test-e2e.sh` (and the
 * `e2e` job in `.github/workflows/ci.yml`) handle that.
 *
 * Mobile-first by design: the only project is iPhone 14 viewport, matching
 * the spec rule in `CLAUDE.md` ("test at 390x844 before declaring UI work
 * done"). Add desktop here later if/when the editorial public site grows.
 */

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3001'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // Each spec is independent; serial mode keeps test output legible while we
  // build the suite. Switch to `fullyParallel: true` once the seed flow is
  // hermetic enough to support parallel users.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: { ...devices['iPhone 14'] },
    },
  ],
})
