/**
 * PRO-83 (specs/metrics.md "App instalada y avisos"): opening Mimoia as an
 * installed app tells the API once a day — no body, nothing about the
 * browser beyond what the API deduces — and a normal browser tab never does.
 */
import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser } from './_helpers'

function countAppOpened(page: Page) {
  const calls: { method: string; body: string | null }[] = []
  page.on('request', (req) => {
    if (req.url().includes('/usage/app-opened')) calls.push({ method: req.method(), body: req.postData() })
  })
  return calls
}

test('the installed app reports one open a day; a browser tab never does', async ({ page }) => {
  test.setTimeout(60_000)
  const calls = countAppOpened(page)
  await registerFreshUser(page)
  await page.waitForTimeout(1_000)
  expect(calls).toHaveLength(0) // plain browser tab

  // Pretend we are the installed app (display-mode: standalone).
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window)
    window.matchMedia = (q: string) =>
      q.includes('display-mode: standalone')
        ? ({ matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false } as unknown as MediaQueryList)
        : real(q)
  })
  const first = page.waitForResponse((r) => r.url().includes('/usage/app-opened'))
  await page.reload()
  expect((await first).status()).toBe(204)
  expect(calls).toHaveLength(1)
  expect(calls[0].method).toBe('POST')
  expect(calls[0].body ?? '').toBe('')

  // Same day, opened again: not reported again.
  await page.reload()
  await page.waitForTimeout(1_500)
  expect(calls).toHaveLength(1)
})
