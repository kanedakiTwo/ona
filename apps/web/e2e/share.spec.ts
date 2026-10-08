/**
 * "Pásalo": sharing must hand out something a non-user can open. Headless
 * Chromium has no Web Share, so share() falls back to the clipboard — we read
 * what would have been shared.
 */

import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

test('menu and catalogue recipe shares carry a link that works without an account', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  await completeOnboarding(page)

  const apiUrl = process.env.API_URL ?? 'http://localhost:8765'
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const d = new Date()
  d.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()))
  const weekStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await page.request.post(`${apiUrl}/menu/generate`, { headers: { Authorization: `Bearer ${token}` }, data: { userId, weekStart } })

  await page.goto('/menu')
  // Since the 2026-10-08 redesign "Compartir" lives in the week's "···" sheet.
  await page.getByRole('button', { name: /opciones de la semana/i }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^compartir$/i }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Mi menú de la semana')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/\?ref=menu$/)

  const [recipe] = await (await page.request.get(`${apiUrl}/recipes?perPage=1`)).json()
  await page.goto(`/recipes/${recipe.id}`)
  await page.getByRole('button', { name: /compartir/i }).first().click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(`/recipes-ona/${recipe.id}?ref=receta`)

  // …and that link opens logged out.
  const shared = await page.evaluate(() => navigator.clipboard.readText())
  const url = new URL(shared.split('\n').pop()!)
  await page.evaluate(() => localStorage.clear())
  await page.goto(url.pathname + url.search)
  await expect(page.getByRole('heading', { name: recipe.name }).first()).toBeVisible({ timeout: 20_000 })
  // Pre-launch the public CTAs lead to the waitlist (specs/waitlist.md).
  await expect(page.getByRole('link', { name: /lista de espera|crear|empieza|prueba|registr/i }).first()).toBeVisible()
})
