/**
 * PRO-143 (beta feedback 2026-10-16): «Lo que recuerdo de ti» and «Creencias»
 * stayed loading. No profile sub-page may hang on its loading state: if what
 * it needs fails or takes more than 8 s, it shows «No hemos podido cargar
 * esto» with «Reintentar», and retrying with a good answer shows the page.
 * The failed request is reported to the in-house tracker (specs/errors.md)
 * with the page path and the API pattern only. A ChunkLoadError reloads the
 * page once.
 */

import { test, expect, type Page, type Route } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

interface Report {
  kind?: string
  message?: string
  path?: string
  stack?: string
}

async function captureReports(page: Page): Promise<Report[]> {
  const reports: Report[] = []
  await page.addInitScript(() => {
    ;(window as Window & { __ONA_ERROR_REPORTING__?: boolean }).__ONA_ERROR_REPORTING__ = true
  })
  await page.route('**/client-errors', async (route) => {
    reports.push(JSON.parse(route.request().postData() || '{}'))
    await route.fulfill({ status: 204 })
  })
  return reports
}

/** GET /memory: 'fail' answers 500, 'hang' never answers, 'ok' goes to the real API. */
async function controlMemory(page: Page) {
  const state = { mode: 'ok' as 'ok' | 'fail' | 'hang', hung: [] as Route[] }
  await page.route('**/memory', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    if (state.mode === 'fail') {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    }
    if (state.mode === 'hang') {
      state.hung.push(route) // never answered
      return
    }
    return route.continue()
  })
  return state
}

test.describe('profile sub-pages: «Reintentar» instead of loading forever', () => {
  test.beforeEach(async ({ page }) => {
    await registerFreshUser(page)
    if (page.url().includes('/onboarding')) await completeOnboarding(page)
  })

  test('memoria: a 500 shows «Reintentar», is reported, and retrying loads the page', async ({ page }) => {
    const reports = await captureReports(page)
    const memory = await controlMemory(page)
    memory.mode = 'fail'

    await page.goto('/profile/memoria')
    await expect(page.getByText('No hemos podido cargar esto')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Perfil físico' })).toHaveCount(0)

    // Reported once per page load: page path + API pattern, no body.
    await expect
      .poll(() => reports.filter((r) => r.message === 'API GET /memory → HTTP 500').length, { timeout: 10_000 })
      .toBe(1)
    const report = reports.find((r) => r.message === 'API GET /memory → HTTP 500')!
    expect(report).toMatchObject({ kind: 'client', path: '/profile/memoria' })
    expect(JSON.stringify(report)).not.toContain('boom')

    memory.mode = 'ok'
    await page.getByRole('button', { name: 'Reintentar' }).click()
    await expect(page.getByRole('heading', { name: 'Perfil físico' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('No hemos podido cargar esto')).toHaveCount(0)
  })

  test('memoria: no answer after 8 s shows «Reintentar»; retrying loads the page', async ({ page }) => {
    test.setTimeout(60_000)
    const reports = await captureReports(page)
    const memory = await controlMemory(page)
    memory.mode = 'hang'

    await page.goto('/profile/memoria')
    await expect(page.getByRole('heading', { name: /recuerdo/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('No hemos podido cargar esto')).toBeVisible({ timeout: 15_000 })
    await expect
      .poll(() => reports.some((r) => r.message === 'API GET /memory: más de 8 s sin respuesta'), { timeout: 5_000 })
      .toBe(true)

    memory.mode = 'ok'
    await page.getByRole('button', { name: 'Reintentar' }).click()
    await expect(page.getByRole('heading', { name: 'Perfil físico' })).toBeVisible({ timeout: 10_000 })
  })

  test('creencias: a 500 shows «Reintentar» and adding a principle stays off until it loads', async ({ page }) => {
    const memory = await controlMemory(page)
    memory.mode = 'fail'

    await page.goto('/profile/creencias')
    await expect(page.getByText('No hemos podido cargar esto')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel('Añadir principio')).toHaveCount(0)

    memory.mode = 'ok'
    await page.getByRole('button', { name: 'Reintentar' }).click()
    await expect(page.getByText(/Tus principios \(0\)/)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByLabel('Añadir principio')).toBeVisible()
  })
})

test('a ChunkLoadError reloads the page once, not twice', async ({ page }) => {
  await page.goto('/')
  let loads = 0
  page.on('load', () => {
    loads += 1
  })

  const throwChunkError = () =>
    page.evaluate(() => {
      const e = new Error('Loading chunk 999 failed.')
      e.name = 'ChunkLoadError'
      void Promise.reject(e)
    })

  // The listener is installed after hydration: throw until the reload happens.
  await expect(async () => {
    await throwChunkError().catch(() => {})
    await page.waitForTimeout(200)
    expect(loads).toBe(1)
  }).toPass({ timeout: 20_000 })
  await page.waitForLoadState('load')
  expect(await page.evaluate(() => sessionStorage.getItem('ona_chunk_reload_at'))).not.toBeNull()

  // Again in the same tab, right after: no second reload (no loop).
  await page.waitForTimeout(1_500) // hydration of the reloaded page
  for (let i = 0; i < 3; i++) {
    await throwChunkError()
    await page.waitForTimeout(300)
  }
  expect(loads).toBe(1)
})
