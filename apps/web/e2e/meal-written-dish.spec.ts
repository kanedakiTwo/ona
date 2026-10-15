/**
 * PRO-74: a home dish that isn't in the catalogue can REPLACE the planned
 * one. Before, a note could only be added next to it (Familia Ruiz kept
 * «Ternera con pimientos» + «Pizza casera…»). Now «Elegir otra receta» with
 * no results offers «Usar "<lo escrito>" como plato», which leaves one dish.
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

test('«Elegir otra receta» → «Usar "<lo escrito>" como plato» replaces the dish (one dish left)', async ({ page }) => {
  test.setTimeout(120_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const { headers, userId } = await session(page)
  const weekStart = thisMonday()
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const menu = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  const today = (new Date().getDay() + 6) % 7
  const meal = MEAL_ORDER.find((m) => menu.days[today]?.[m]?.dishes?.some((d: { kind: string }) => d.kind === 'recipe'))
  test.skip(!meal, 'the generator left today without recipes')

  await page.goto('/menu')
  const hero = page.getByTestId('menu-hero')
  await expect(hero).toBeVisible({ timeout: 20_000 })
  await hero.getByRole('button', { name: /más opciones/i }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^elegir otra receta$/i }).click()

  const text = 'Pizza casera de la abuela Rosi'
  await page.getByPlaceholder('Buscar receta…').fill(text)
  await page.getByRole('button', { name: `Usar “${text}” como plato` }).click()

  await expect
    .poll(async () => {
      const m = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
      return m.days[today]?.[meal!]?.dishes
    }, { timeout: 10_000 })
    .toEqual([{ kind: 'note', text }])

  // The day shows the written dish once, and the old recipe is gone from that meal.
  await page.reload()
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 })
})
