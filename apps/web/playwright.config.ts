import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config for the ONA web E2E suite.
 *
 * The API + Web servers must be running on the URLs below before the suite
 * starts. The orchestration script `apps/web/scripts/test-e2e.sh` (and the
 * `e2e` job in `.github/workflows/ci.yml`) handle that.
 *
 * Mobile-first by design: a Chromium-based mobile preset matching the spec
 * rule in `CLAUDE.md` ("test at 390x844 before declaring UI work done"). We
 * use Pixel 7 (Chromium) rather than iPhone 14 because the iPhone preset
 * pins to WebKit and the CI workflow only installs Chromium to keep the
 * cache small. Add desktop / WebKit projects later if those become useful.
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
      use: {
        ...devices['Pixel 7'],
        // Provide a fake audio input device + auto-grant getUserMedia so the
        // voice-mode toggle's permission probe doesn't reject in CI's
        // headless Chromium (no real microphone).
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
          ],
        },
      },
    },
  ],
})
