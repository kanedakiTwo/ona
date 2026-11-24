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
  // CI: `github` turns each failure into an annotation (file, line and
  // message) that Mimoia HQ's estado_ci reads from the API without a token.
  // flaky-reporter (PRO-398) lists the tests that only passed on the retry:
  // a warning annotation each and playwright-report/flaky.{json,md}. It goes
  // after `html`, which empties that folder when it finishes.
  reporter: process.env.CI
    ? [['list'], ['github'], ['html', { open: 'never' }], ['./e2e/flaky-reporter.ts']]
    : [['list'], ['./e2e/flaky-reporter.ts']],
  use: {
    baseURL: WEB_URL,
    // The app's weeks are Madrid weeks (firstMenuWeeks, the API). A UTC
    // browser disagrees between 00:00 and 02:00 on Monday, Madrid time, and
    // /menu then generates a second week (PRO-243).
    timezoneId: 'Europe/Madrid',
    // A production build (`next build`, the CI since PRO-398) registers the
    // service worker, which caches API answers and reloads the page when it
    // takes over. No spec tests it, so it stays off, as under `next dev`.
    serviceWorkers: 'block',
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
