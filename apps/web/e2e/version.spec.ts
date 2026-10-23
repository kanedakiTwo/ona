/**
 * PRO-OF-2: the web's /version.json and the API's GET /version say which
 * commit is served (the VERSION_SHA file the deploy writes), public and
 * uncached, so a publish can check it. CI writes no VERSION_SHA: sha is null.
 * The folder walk itself is unit-tested in apps/api/src/tests/version.test.ts.
 */
import { test, expect } from '@playwright/test'

const API = process.env.API_URL ?? 'http://localhost:8765'
const shaOrNull = (v: unknown) => v === null || (typeof v === 'string' && /^[0-9a-f]{40}$/.test(v))

for (const [name, url] of [['web /version.json', '/version.json'], ['API /version', `${API}/version`]] as const) {
  test(`${name}: public JSON with only the sha, never cached`, async ({ request }) => {
    const res = await request.get(url, { maxRedirects: 0 })
    expect(res.status()).toBe(200)
    expect(res.headers()['cache-control']).toContain('no-store')
    const body = await res.json()
    expect(Object.keys(body)).toEqual(['sha'])
    expect(shaOrNull(body.sha)).toBe(true)
  })
}
