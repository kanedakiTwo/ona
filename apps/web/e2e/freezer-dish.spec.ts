/**
 * PRO-82: «Añadir comida → Del congelador» puts a táper from the freezer in a
 * missing meal: it is linked to its recipe, shows «Del congelador» and the
 * shopping list doesn't change (whatever week the original was cooked in).
 */

import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const API = process.env.API_URL ?? 'http://localhost:8765'

function thisMonday(): string {
  const d = new Date()
  d.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { headers: { Authorization: `Bearer ${token}` }, userId }
}

test('«Añadir comida → Del congelador» adds the táper with its label and the shopping list stays the same', async ({ page }) => {
  test.setTimeout(120_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const { headers, userId } = await session(page)
  const weekStart = thisMonday()
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const menu = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()

  // Today without dinner, so «Añadir comida» offers it.
  const today = (new Date().getDay() + 6) % 7
  if (menu.days[today]?.dinner) {
    const del = await page.request.delete(`${API}/menu/${menu.id}/day/${today}/meal/dinner`, { headers })
    expect(del.ok(), `delete dinner: ${del.status()}`).toBeTruthy()
  }
  const todayIso = iso(new Date())
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

  // The list for today is the same as before the táper.
  expect(await itemsOf()).toEqual(before)
})
