/**
 * PRO-82: «Añadir comida → Del congelador» puts a táper from the freezer in a
 * missing meal: it is linked to its recipe, shows «Del congelador» and the
 * shopping list doesn't change (whatever week the original was cooked in).
 * PRO-240: the same with «Táper de la nevera»; every táper shows its recipe's
 * name and never offers «Empezar a cocinar».
 */

import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'
import { madridToday, madridTodayIdx, pinClock } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'


async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { headers: { Authorization: `Bearer ${token}` }, userId }
}

test('«Añadir comida → Del congelador» adds the táper with its label and the shopping list stays the same', async ({ page }) => {
  test.setTimeout(120_000)
  // The page's «today» is Madrid's at midday, the same day the spec reads (PRO-273).
  const day = await pinClock(page, madridTodayIdx())
  await registerFreshUser(page)
  await completeOnboarding(page)
  const { headers, userId } = await session(page)
  const { weekStart, dayIdx: today } = day
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const menu = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()

  // Today without dinner, so «Añadir comida» offers it.
  if (menu.days[today]?.dinner) {
    const del = await page.request.delete(`${API}/menu/${menu.id}/day/${today}/meal/dinner`, { headers })
    expect(del.ok(), `delete dinner: ${del.status()}`).toBeTruthy()
  }
  const todayIso = madridToday()
  const listQuery = `from=${todayIso}&to=${todayIso}`
  const itemsOf = async () =>
    ((await (await page.request.get(`${API}/shopping-list?${listQuery}`, { headers })).json()).items ?? [])
      .filter((i: { kind?: string }) => i.kind !== 'manual' && i.kind !== 'staple')
      .map((i: { name: string; quantity: number; unit: string }) => `${i.name}|${i.quantity}|${i.unit}`)
      .sort()
  const before = await itemsOf()

  await page.goto('/menu')
  await expect(page.getByRole('button', { name: /^añadir comida$/i })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /^añadir comida$/i }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^del congelador$/i }).click()

  // Which meal (only when the day lacks more than one), then the recipe.
  const mealStep = page.getByRole('dialog', { name: '¿Para qué comida?' })
  await page.waitForTimeout(400) // the «Añadir comida» sheet is closing
  if (await mealStep.isVisible().catch(() => false)) {
    await mealStep.getByRole('button', { name: /^cena$/i }).click()
  }
  await expect(page.getByText('Cena · no suma a la compra')).toBeVisible({ timeout: 10_000 })
  const picker = page.getByRole('dialog').filter({ has: page.getByPlaceholder('Buscar receta…') })
  // Any recipe will do: the list must not change, whichever it is.
  await picker.getByRole('button').filter({ hasNotText: /^$/ }).filter({ hasNot: page.getByLabel('Cerrar') }).last().click()

  await expect(page.getByText('Del congelador · no suma a la compra')).toBeVisible({ timeout: 10_000 })
  const after = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  const dish = after.days[today].dinner.dishes[0]
  expect(dish).toMatchObject({ kind: 'recipe', variant: 'freezer' })
  expect(typeof dish.recipeId).toBe('string')
  // PRO-240: saved and read with its recipe's name; nothing to cook.
  expect(dish.recipeName).toBeTruthy()
  await expect(page.locator(`a[href^="/recipes/${dish.recipeId}/cook"]`)).toHaveCount(0)

  // The list for today is the same as before the táper.
  expect(await itemsOf()).toEqual(before)
})

test('«Táper de la nevera» (PRO-240): its own label, its name, no «Empezar a cocinar», and the list stays the same', async ({ page }) => {
  test.setTimeout(120_000)
  const day = await pinClock(page, madridTodayIdx())
  await registerFreshUser(page)
  await completeOnboarding(page)
  const { headers, userId } = await session(page)
  const weekStart = day.weekStart
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const menu = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  const today = day.dayIdx
  // Every meal of today becomes a táper of the nevera, saved without a name
  // (as Mimo saved them): the hero is one of them, whichever it is.
  const meals = Object.keys(menu.days[today] ?? {})
  expect(meals.length).toBeGreaterThan(0)
  const recipeId = menu.days[today][meals[0]].dishes.find((d: { kind: string }) => d.kind === 'recipe')?.recipeId
  expect(recipeId, 'a recipe on today').toBeTruthy()
  const todayIso = madridToday()
  const itemsOf = async () =>
    ((await (await page.request.get(`${API}/shopping-list?from=${todayIso}&to=${todayIso}`, { headers })).json()).items ?? [])
      .filter((i: { kind?: string }) => i.kind !== 'manual' && i.kind !== 'staple')
      .map((i: { name: string; quantity: number; unit: string }) => `${i.name}|${i.quantity}|${i.unit}`)
  for (const meal of meals) {
    const del = await page.request.delete(`${API}/menu/${menu.id}/day/${today}/meal/${meal}`, { headers })
    expect(del.ok(), `delete ${meal}: ${del.status()}`).toBeTruthy()
    const add = await page.request.post(`${API}/menu/${menu.id}/day/${today}/meal/${meal}/dish`, {
      headers,
      data: { kind: 'recipe', recipeId, variant: 'fridge' },
    })
    expect(add.ok(), `add ${meal}: ${add.status()}`).toBeTruthy()
  }
  const after = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  const name = after.days[today][meals[0]].dishes[0].recipeName as string
  expect(name, 'the táper carries its recipe name').toBeTruthy()
  expect(after.days[today][meals[0]].dishes[0].variant).toBe('fridge')
  // Nothing of today's tápers is on today's list.
  expect(await itemsOf()).toEqual([])

  await page.goto('/menu')
  const hero = page.getByTestId('menu-hero')
  await expect(hero).toBeVisible({ timeout: 20_000 })
  await expect(hero.getByRole('heading', { name })).toBeVisible()
  await expect(hero.getByText('Táper de la nevera · no suma a la compra')).toBeVisible()
  await expect(hero.getByTestId('taper-see-recipe')).toBeVisible()
  await expect(page.getByRole('link', { name: /empezar a cocinar/i })).toHaveCount(0)
  await expect(page.getByText(/^Receta$/)).toHaveCount(0)
  await expect(page.getByText(/del congelador/i)).toHaveCount(0)
})
