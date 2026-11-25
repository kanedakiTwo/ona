/**
 * PRO-1036: «Sin conexión» only when the browser has no network.
 *
 * The test households' headless Chromium (no network interface of its own,
 * the web through a proxy) says `navigator.onLine === false` while every page
 * loads and saves: the banner sat over Menú, Compra, Recetas and Perfil and
 * covered the menu's «Semana siguiente» arrow. Now `onLine` false is checked
 * with a request to the API (lib/pwa/network.ts).
 * Mobile (390×844).
 */
import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

test.use({ viewport: { width: 390, height: 844 } })

const banner = (page: import('@playwright/test').Page) => page.getByRole('status').filter({ hasText: 'Sin conexión' })

test('with network, /menu has no «Sin conexión» — even when navigator.onLine says false', async ({ page }) => {
  test.setTimeout(120_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  await expect(page.getByRole('main').getByRole('button', { name: 'Semana siguiente' })).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(1_500)
  await expect(banner(page)).toHaveCount(0)

  // The households' browser: onLine false, network fine.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false })
  })
  await page.goto('/menu')
  await expect(page.getByRole('main').getByRole('button', { name: 'Semana siguiente' })).toBeVisible({ timeout: 30_000 })
  expect(await page.evaluate(() => navigator.onLine)).toBe(false)
  await page.waitForTimeout(2_500)
  await expect(banner(page)).toHaveCount(0)
})

test('without network, /menu shows «Sin conexión», and it goes when the network is back', async ({ page, context }) => {
  test.setTimeout(120_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  await expect(page.getByRole('main').getByRole('button', { name: 'Semana siguiente' })).toBeVisible({ timeout: 30_000 })
  await expect(banner(page)).toHaveCount(0)

  await context.setOffline(true)
  await expect(banner(page)).toBeVisible({ timeout: 15_000 })

  await context.setOffline(false)
  await expect(banner(page)).toHaveCount(0, { timeout: 15_000 })
})
