import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Pick up the standard *.test.ts files plus *.smoke.ts integration smokes
    // (e.g. tests/usdaClient.smoke.ts). Smoke tests skip themselves when the
    // required env vars are absent, so they're safe to include in default runs.
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/**/*.smoke.?(c|m)[jt]s?(x)',
    ],
  },
})
