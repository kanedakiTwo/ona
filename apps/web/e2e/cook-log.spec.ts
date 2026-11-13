/**
 * Flow: record a cook from the recipe detail page → see the count update.
 *
 * The "Cocinada" CTA (Notas tab of the detail since the 2026-10-08 redesign)
 * POSTs to /cook-logs and invalidates the per-recipe stats query, so the same
 * button re-renders as "Cocinada 1×". This spec is the regression for PR 6 —
 * without the cook-log surface, the button wouldn't exist at all.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding, menuWithRecipesOn } from './_helpers'

const API = process.env.API_URL ?? 'http://localhost:8765'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('recipe detail: marking cooked increments the count', async ({ page }) => {
  // Open the catalog and pick the first recipe card. Scoped to <main> (the
  // desktop sidebar is in the DOM but hidden on mobile) and excluding
  // `/recipes/new` (the "Nueva receta" button in the header).
  await page.goto('/recipes')
  const card = page
    .getByRole('main')
    .locator('a[href^="/recipes/"]:not([href="/recipes/new"])')
    .first()
  await expect(card).toBeVisible({ timeout: 10_000 })
  await Promise.all([page.waitForURL(/\/recipes\/[0-9a-f-]{36}(\?|$)/), card.click()])

  // "Empezar a cocinar" lives in the sticky bottom action bar; the
  // "Cocinada" button lives in the Notas tab, so open it and scope to it.
  await expect(
    page.getByTestId('recipe-action-bar').getByRole('link', { name: /^empezar a cocinar$/i }),
  ).toBeVisible({ timeout: 10_000 })
  await page.getByRole('tab', { name: /^notas$/i }).click()
  const cookSection = page.getByRole('tabpanel', { name: /notas/i })

  // The button's accessible name is its aria-label ("Marcar como cocinada");
  // the visible text carries the count.
  const cookedBtn = cookSection.getByRole('button', { name: /marcar como cocinada/i })
  await expect(cookedBtn).toBeVisible({ timeout: 10_000 })

  // Initial state — never cooked: label is just "Cocinada" (no count).
  await expect(cookedBtn).toHaveText(/^cocinada$/i)

  // Click it. The button text should switch to "Cocinada 1×".
  await cookedBtn.click()
  await expect(cookedBtn).toHaveText(/^cocinada 1×$/i, { timeout: 10_000 })
})

test('«Cocinar» tab: «Empezar a cocinar» on the meal of now → «Terminar» logs it with its slot and leaves it «✓ Comido» (PRO-1109)', async ({ page }) => {
  test.setTimeout(150_000)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const headers = { Authorization: `Bearer ${token}` }
  // The API's meal of now, with a recipe planned in it.
  const { weekStart, day, meal } = await (await page.request.get(`${API}/cook-now/today`, { headers })).json()
  expect(meal, 'a fresh household has a meal of now').not.toBeNull()
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const menu = await menuWithRecipesOn(page, headers, userId, weekStart, [[day, meal]])

  await page.goto('/cocinar')
  await page.getByTestId('cook-now-today').getByRole('link', { name: /empezar a cocinar/i }).click()
  await page.waitForURL((u) => u.pathname.endsWith('/cook') && u.searchParams.get('menu') === menu.id, { timeout: 20_000 })

  const next = page.getByRole('button', { name: 'Paso siguiente' })
  const finish = page.getByRole('button', { name: /^terminar$/i })
  await expect(next.or(finish)).toBeVisible({ timeout: 15_000 })
  for (let i = 0; i < 40 && !(await finish.isVisible()); i++) await next.click()
  const logged = page.waitForRequest((r) => r.url().endsWith('/cook-logs') && r.method() === 'POST')
  await finish.click()
  expect((await logged).postDataJSON()).toMatchObject({ menuId: menu.id, dayIndex: day, meal })
  const prompt = page.getByTestId('rating-prompt')
  await expect(prompt.or(page.getByTestId('menu-hero'))).toBeVisible({ timeout: 15_000 })
  if (await prompt.isVisible()) await prompt.getByRole('button', { name: 'Bien' }).click()
  await page.waitForURL((u) => u.pathname === '/menu', { timeout: 15_000 })

  await expect
    .poll(async () => {
      const m = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
      return m.days[day]?.[meal]?.eaten ?? false
    }, { timeout: 10_000 })
    .toBe(true)
})
