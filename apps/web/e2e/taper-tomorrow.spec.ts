/**
 * PRO-223 · «El táper de mañana» from the meal sheet: Tuesday's lunch → «Me lo
 * llevo en táper» → it shows as the leftovers of Monday's dinner («ya en la
 * compra»), Monday's dinner is cooked for one more, and «Quitar táper» undoes
 * it. The list arithmetic is unit-tested in apps/api/src/tests/taper.test.ts.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, menuWithRecipesOn, registerFreshUser } from './_helpers'
import { madridMondayIn } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'

/** Monday `weeks` weeks from now, in Madrid (the runner is UTC on CI). */
const mondayIn = (weeks: number) => madridMondayIn(weeks)

async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { headers: { Authorization: `Bearer ${token}` }, userId }
}

test('Tuesday lunch as táper of Monday dinner, and back', async ({ page }) => {
  test.setTimeout(120_000)
  await registerFreshUser(page)
  await completeOnboarding(page) // household of 1
  const { headers, userId } = await session(page)
  const weekStart = mondayIn(1)
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  // Monday's dinner and Tuesday's lunch with a recipe, whatever the generator left.
  const menu = await menuWithRecipesOn(page, headers, userId, weekStart, [[0, 'dinner'], [1, 'lunch']])
  const dinnerName = menu.days[0].dinner.dishes.find((d: { kind: string }) => d.kind === 'recipe').recipeName as string

  await page.goto(`/menu?week=${weekStart}`)
  const strip = page.getByRole('navigation', { name: 'Días de la semana' })
  await expect(strip).toBeVisible({ timeout: 20_000 })
  await strip.getByRole('button').nth(1).click()
  await page.getByRole('button', { name: /^Más opciones de comida/ }).first().click()
  await page.getByRole('button', { name: /Me lo llevo en táper/ }).click()
  await expect(page.getByText(/sobras de lun cena · ya en la compra/i).first()).toBeVisible({ timeout: 10_000 })

  const after = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  expect(after.days[1].lunch).toMatchObject({ taper: 1, servings: 1 })
  expect(after.days[1].lunch.dishes[0]).toMatchObject({ recipeName: dinnerName, variant: 'leftover', leftoverOf: { day: 0, meal: 'dinner' } })

  // «Quitar táper» leaves the lunch empty.
  await page.getByRole('button', { name: /^Más opciones de comida/ }).first().click()
  await page.getByRole('button', { name: /Quitar táper/ }).click()
  await expect(page.getByText(/sobras de lun cena/i)).toHaveCount(0, { timeout: 10_000 })
  const undone = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  expect(undone.days[1].lunch.dishes).toEqual([])
})
