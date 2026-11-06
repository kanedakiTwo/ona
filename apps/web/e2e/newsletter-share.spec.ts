/**
 * «Corre la voz» in the newsletter (PRO-1019, specs/newsletter.md): the
 * «Copiar el enlace» button lands on /newsletter/comparte?c=<code>&k=…, which
 * shows the person's own link (the household's /i/<code> or the list's
 * ?invita=<code>), copies it and opens WhatsApp with it. A slot link of an
 * issue that was never sent is a 404 and redirects nowhere. The counting
 * itself is in apps/api/src/tests/newsletter.test.ts.
 */

import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

test('the copy page shows the household link, copies it and opens WhatsApp with it', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/newsletter/comparte?c=hgar2345&k=hogar')
  const link = `${new URL(baseURL!).origin}/i/hgar2345`
  await expect(page.getByTestId('share-link')).toHaveText(link)
  const wa = await page.getByTestId('share-whatsapp').getAttribute('href')
  expect(wa).toMatch(/^https:\/\/wa\.me\/\?text=/)
  expect(decodeURIComponent(wa!.split('text=')[1])).toContain(link)
  await page.getByTestId('share-copy').click()
  await expect(page.getByTestId('share-copy')).toHaveText(/Copiado/)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link)
})

test('the copy page shows a waitlist person their ?invita link', async ({ page, baseURL }) => {
  await page.goto('/newsletter/comparte?c=ana23456&k=lista')
  await expect(page.getByTestId('share-link')).toHaveText(`${new URL(baseURL!).origin}/?invita=ana23456`)
})

test('a broken code says so and offers nothing to share', async ({ page }) => {
  await page.goto('/newsletter/comparte?c=https://malo.example&k=hogar')
  await expect(page.getByRole('heading', { name: 'Este enlace no es válido.' })).toBeVisible()
  await expect(page.getByTestId('share-whatsapp')).toHaveCount(0)
})

test('/n/<issue>/41 of an issue never sent: 404, no redirect', async ({ request }) => {
  for (const path of ['/n/no-existe/41?c=ana23456&k=lista', '/n/no-existe/42?c=https://example.com&k=hogar']) {
    const r = await request.get(path, { maxRedirects: 0 })
    expect(r.status(), path).toBe(404)
    expect(r.headers()['location'], path).toBeUndefined()
  }
})
