/**
 * «Deseos del catálogo» (PRO-154, specs/catalog-import.md): a favourite dish
 * from the sign-up that the catalogue doesn't have shows up in Admin →
 * Catálogo → «Deseos del catálogo», with how many households ask for it and
 * where it came from — no names. Mobile.
 */

import { test, expect, type Page } from '@playwright/test'
import { E2E_ADMIN } from './global-setup'
import { registerFreshUser, uniqueId } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

async function loginAsAdmin(page: Page) {
  const r = await page.request.post(`${API_URL}/login`, {
    data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password },
  })
  expect(r.ok()).toBeTruthy()
  const { token, user } = await r.json()
  test.skip(user?.role !== 'admin', 'needs ADMIN_EMAILS on the API (see global-setup.ts)')
  await page.addInitScript(
    ([t, u]) => {
      localStorage.setItem('ona_token', t)
      localStorage.setItem('ona_user', u)
    },
    [token, JSON.stringify(user)] as const,
  )
}

test('a sign-up favourite we lack → «Deseos del catálogo» in Admin', async ({ page, browser }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await registerFreshUser(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user')))!).id as string
  const dish = `Rodaballo zzq${uniqueId().replace(/[^a-z0-9]/gi, '').slice(-6)} al horno`
  const res = await page.request.post(`${API_URL}/user/${userId}/onboarding`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], favoriteDishes: [dish, 'pasta'], priority: 'varied' },
  })
  expect(res.ok()).toBeTruthy()

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const admin = await ctx.newPage()
  await loginAsAdmin(admin)
  await admin.goto('/admin')
  await admin.getByRole('button', { name: /Deseos del catálogo/ }).click()
  const section = admin.getByTestId('catalog-wishes-section')
  const item = section.getByTestId('catalog-wish').filter({ hasText: dish })
  await expect(item).toBeVisible({ timeout: 15_000 })
  await expect(item).toContainText('favoritos del alta')
  await expect(item).toContainText('1')
  await expect(item).toContainText('hogar')
  await ctx.close()
})
