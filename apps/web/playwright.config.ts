import fs from 'node:fs'
import { defineConfig, devices, webkit } from '@playwright/test'

/**
 * Playwright config for the Mimoia web E2E suite.
 *
 * The API + Web servers must be running on the URLs below before the suite
 * starts. The orchestration script `apps/web/scripts/test-e2e.sh` (and the
 * `e2e` job in `.github/workflows/ci.yml`) handle that.
 *
 * Mobile-first by design: a Chromium-based mobile preset matching the spec
 * rule in `CLAUDE.md` ("test at 390x844 before declaring UI work done"). We
 * use Pixel 7 (Chromium) rather than iPhone 14 because the iPhone preset
 * pins to WebKit and the CI workflow only installs Chromium to keep the
 * cache small. The iPhone sign-up (register-iphone.spec.ts) also runs in a
 * WebKit project wherever WebKit is installed (PRO-354).
 */

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3001'

/**
 * PRO-354: the sign-up also runs on an iPhone (WebKit) when WebKit is
 * installed (`playwright install webkit`). Without it the project is left
 * out, so a Chromium-only machine or CI job still runs the suite.
 */
function webkitInstalled(): boolean {
  try {
    return fs.existsSync(webkit.executablePath())
  } catch {
    return false
  }
}

export default defineConfig({
  testDir: './e2e',
  // Closed beta (PRO-27): creates the "e2e" campaign link the specs sign up with.
  globalSetup: './e2e/global-setup.ts',
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
    // The app's weeks are Madrid weeks (firstMenuWeeks, the API). A UTC
    // browser disagrees between 00:00 and 02:00 on Monday, Madrid time, and
    // /menu then generates a second week (PRO-243).
    timezoneId: 'Europe/Madrid',
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
    ...(webkitInstalled()
      ? [
          {
            name: 'mobile-webkit',
            testMatch: /register-iphone\.spec\.ts$/,
            use: { ...devices['iPhone 14'], viewport: { width: 390, height: 844 } },
          },
        ]
      : []),
  ],
})
