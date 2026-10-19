/**
 * Newsletter links (PRO-191, specs/newsletter.md), against the real API + DB:
 * mimoia.com/n/<issue>/<n> for an issue or link that was never sent answers
 * 404 and redirects nowhere (no open redirect). The counting itself is in
 * apps/api/src/tests/newsletter.test.ts.
 */

import { test, expect } from '@playwright/test'

test('/n/<issue>/<n> that was never sent: 404, no redirect', async ({ request }) => {
  for (const path of ['/n/no-existe/1', '/n/no-existe/1?url=https://example.com', '/n/X/abc']) {
    const r = await request.get(path, { maxRedirects: 0 })
    expect(r.status(), path).toBe(404)
    expect(r.headers()['location'], path).toBeUndefined()
  }
})
