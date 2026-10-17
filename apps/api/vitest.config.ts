import { defineConfig } from 'vitest/config'
import { isLateConsoleLogOnTeardown } from './src/tests/vitestTeardown.js'

export default defineConfig({
  test: {
    // Pick up the standard *.test.ts files plus *.smoke.ts integration smokes
    // (e.g. tests/usdaClient.smoke.ts). Smoke tests skip themselves when the
    // required env vars are absent, so they're safe to include in default runs.
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/**/*.smoke.?(c|m)[jt]s?(x)',
    ],
    // A log line that a finished test file's fire-and-forget code prints
    // while its worker is closing makes vitest report «Closing rpc while
    // "onUserConsoleLog" was pending» and fail the run with every test
    // passed (2026-10-16: twice, from different files). Ignore exactly that
    // error; any other unhandled error still fails the run (PRO-173).
    onUnhandledError(error) {
      return !isLateConsoleLogOnTeardown(error)
    },
  },
})
