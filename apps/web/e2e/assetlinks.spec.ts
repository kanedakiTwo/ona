import { expect, test } from '@playwright/test'

// The Android app (specs/android-app.md) opens full screen only if the web declares it here (Digital Asset Links).
test('assetlinks.json is served as JSON and declares both Mimoia apps', async ({ request }) => {
  const r = await request.get('/.well-known/assetlinks.json', { maxRedirects: 0 })
  expect(r.status()).toBe(200)
  expect(r.headers()['content-type']).toContain('application/json')
  const decl = (await r.json()) as Array<{ target: { package_name: string } }>
  expect(decl.map((d) => d.target.package_name).sort()).toEqual(['com.mimoia.app', 'com.mimoia.app.pruebas'])
})
