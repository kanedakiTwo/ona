/**
 * PRO-75: a planned leftover ("táper") is part of its source's batch. Laura
 * (household of 1) set Monday's lasaña to «Solo hoy: 2» with leftovers on
 * Tuesday; the list bought 4 servings and tapping the lasaña opened the recipe
 * «Para 1 ración». Now the leftover doesn't copy the 2, says «ya en la
 * compra», and the source dish opens the recipe at the batch (2 raciones).
 * The list arithmetic is unit-tested in apps/api/src/tests/leftoverBatches.test.ts.
 */

import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const API = process.env.API_URL ?? 'http://localhost:8765'
const MEAL_ORDER = ['breakfast', 'lunch', 'snack', 'dinner']

function thisMonday(): string {
  const d = new Date()
  d.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { headers: { Authorization: `Bearer ${token}` }, userId }
}

test('the source of a táper opens its recipe for the whole batch; the táper says it is already in the list', async ({ page }) => {
  test.setTimeout(120_000)
  await registerFreshUser(page)
  await completeOnboarding(page) // household of 1
  const { headers, userId } = await session(page)
  const weekStart = thisMonday()
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const menu = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()

  const today = (new Date().getDay() + 6) % 7
  const meal = MEAL_ORDER.find((m) => menu.days[today]?.[m]?.dishes?.some((d: { kind: string }) => d.kind === 'recipe'))
  test.skip(!meal, 'the generator left today without recipes')
  const name = menu.days[today][meal!].dishes.find((d: { kind: string }) => d.kind === 'recipe').recipeName as string

  // «Solo hoy: 2» on today's featured meal…
  const patch = await page.request.patch(`${API}/menu/${menu.id}/day/${today}/meal/${meal}`, { headers, data: { servings: 2 } })
  expect(patch.ok(), `servings: ${patch.status()}`).toBeTruthy()
  // …and its leftovers on another day (emptied first).
  const other = today === 6 ? 5 : today + 1
  if (menu.days[other]?.lunch) {
    const del = await page.request.delete(`${API}/menu/${menu.id}/day/${other}/meal/lunch`, { headers })
    expect(del.ok(), `delete: ${del.status()}`).toBeTruthy()
  }
  const lo = await page.request.post(`${API}/menu/${menu.id}/day/${other}/leftover`, {
    headers,
    data: { sourceDay: today, sourceMeal: meal, targetMeal: 'lunch' },
  })
  expect(lo.status(), `leftover: ${lo.status()}`).toBe(201)
  const withLeftover = await lo.json()
  // The leftover no longer copies the source's «Solo hoy».
  expect(withLeftover.days[other].lunch.servings ?? null).toBeNull()

  // The other day shows the táper as already bought, without «Solo hoy».
  await page.goto('/menu')
  await expect(page.getByTestId('menu-hero')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('navigation', { name: 'Días de la semana' }).getByRole('button').nth(other).click()
  await expect(page.getByText(/sobras de .* · ya en la compra/i).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/^solo hoy:/i)).toHaveCount(0)

  // Back to today: tapping the dish opens the recipe «Para 2 raciones».
  await page.getByRole('navigation', { name: 'Días de la semana' }).getByRole('button').nth(today).click()
  const hero = page.getByTestId('menu-hero')
  await hero.getByRole('link', { name }).first().click()
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}\?servings=2$/, { timeout: 15_000 })
  await expect(page.getByTestId('servings-value').first()).toHaveText('2 raciones', { timeout: 15_000 })
})
