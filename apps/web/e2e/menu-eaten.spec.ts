/**
 * PRO-185 (Dani y Sara, 2026-10-16): a meal marked eaten (by Mimo, which
 * writes `eaten` on the slot, or «Marcar como cocinada» on the web) still
 * offered «Empezar a cocinar». Now the card shows «✓ Comido» + «Ver receta»,
 * «Desmarcar» undoes it, and a written dish («Cenamos fuera») shows once.
 */

import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'
import { madridTodayIdx, pinClock } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'
const MEAL_ORDER = ['breakfast', 'lunch', 'snack', 'dinner']


async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { headers: { Authorization: `Bearer ${token}` }, userId }
}

async function todayMenu(page: Page) {
  // The page's «today» is Madrid's at midday, the same day the spec reads (PRO-273).
  const day = await pinClock(page, madridTodayIdx())
  await registerFreshUser(page)
  await completeOnboarding(page)
  const { headers, userId } = await session(page)
  const { weekStart, dayIdx: today } = day
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const menu = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  const withRecipe = MEAL_ORDER.filter((m) => menu.days[today]?.[m]?.dishes?.some((d: { kind: string }) => d.kind === 'recipe'))
  return { headers, userId, weekStart, menu, today, withRecipe }
}

test.use({ viewport: { width: 390, height: 844 } })

test('a meal marked eaten shows «✓ Comido», not «Empezar a cocinar»; «Desmarcar» and «Marcar como cocinada» toggle it', async ({ page }) => {
  test.setTimeout(150_000)
  const { headers, userId, weekStart, menu, today, withRecipe } = await todayMenu(page)
  const featured = withRecipe[0]
  test.skip(!featured, 'the generator left today without recipes')

  // What Mimo's `mark_meal_eaten` leaves on the slot (here through the same PATCH the web uses).
  const patch = await page.request.patch(`${API}/menu/${menu.id}/day/${today}/meal/${featured}`, { headers, data: { eaten: true } })
  expect(patch.ok(), `patch: ${patch.status()}`).toBeTruthy()

  await page.goto('/menu')
  const hero = page.getByTestId('menu-hero')
  await expect(hero).toBeVisible({ timeout: 20_000 })
  await expect(hero.getByTestId('meal-eaten')).toHaveText(/comido/i)
  await expect(hero.getByRole('link', { name: /^ver receta$/i })).toBeVisible()
  await expect(hero.getByRole('link', { name: /empezar a cocinar/i })).toHaveCount(0)

  // «Desmarcar» brings «Empezar a cocinar» back.
  await hero.getByRole('button', { name: /más opciones/i }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^desmarcar/i }).click()
  await expect(hero.getByRole('link', { name: /empezar a cocinar/i })).toBeVisible({ timeout: 10_000 })
  await expect(hero.getByTestId('meal-eaten')).toHaveCount(0)

  // «Marcar como cocinada» on the web marks it eaten too.
  await hero.getByRole('button', { name: /más opciones/i }).click()
  await page.getByRole('dialog').getByRole('button', { name: /marcar como cocinada/i }).click()
  await expect
    .poll(async () => {
      const m = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
      return m.days[today]?.[featured]?.eaten ?? false
    }, { timeout: 10_000 })
    .toBe(true)
  await page.reload()
  await expect(page.getByTestId('menu-hero').getByTestId('meal-eaten')).toBeVisible({ timeout: 20_000 })
})

test('a written dish («Cenamos fuera») shows once on its row', async ({ page }) => {
  test.setTimeout(150_000)
  const { headers, menu, today, withRecipe } = await todayMenu(page)
  const other = MEAL_ORDER.find((m) => m !== withRecipe[0] && menu.days[today]?.[m])
  test.skip(!withRecipe[0] || !other, 'today has no second meal')

  const base = `${API}/menu/${menu.id}/day/${today}/meal/${other}`
  expect((await page.request.delete(base, { headers })).ok()).toBeTruthy()
  const add = await page.request.post(`${base}/dish`, { headers, data: { kind: 'note', text: 'Cenamos fuera' } })
  expect(add.ok(), `add note: ${add.status()}`).toBeTruthy()

  await page.goto('/menu')
  await expect(page.getByTestId('menu-hero')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('main').getByText('Cenamos fuera')).toHaveCount(1)
  await expect(page.getByRole('main').getByText(/\+ Cenamos fuera/)).toHaveCount(0)
})
