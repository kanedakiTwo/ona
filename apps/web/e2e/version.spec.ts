import { expect, test } from '@playwright/test'

// PRO-365 (specs/version.md): the web and the API say the deployed commit (null without VERSION_SHA).
test('the web and the API say the same commit', async ({ request }) => {
  // `next dev` compiles the route on its first hit (slow on a cold runner).
  test.setTimeout(90_000)
  const web = await request.get('/version.json', { maxRedirects: 0, timeout: 80_000 })
  expect(web.status()).toBe(200)
  expect(web.headers()['content-type']).toContain('application/json')
  const webBody = (await web.json()) as { sha: string | null }
  expect(Object.keys(webBody)).toEqual(['sha'])
  if (webBody.sha !== null) expect(webBody.sha).toMatch(/^[0-9a-f]{40}$/)

  const apiUrl = process.env.API_URL ?? 'http://localhost:8765'
  const api = await request.get(`${apiUrl}/version`)
  expect(api.status()).toBe(200)
  expect(api.headers()['cache-control']).toBe('no-store')
  expect(await api.json()).toEqual(webBody)
})
