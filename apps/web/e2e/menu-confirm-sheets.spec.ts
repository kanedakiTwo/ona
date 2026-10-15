/**
 * PRO-72: «Saltar día», «Quitar comida» and «Vetar esta receta» did nothing
 * for two test households. They asked for confirmation with the browser's
 * native `window.confirm`; when that window isn't shown or closes by itself
 * (automated browsers, some in-app browsers) it counts as «Cancelar": no
 * request, no notice, the sheet stays open.
 *
 * Now they confirm in the app's own sheet. This spec never accepts a browser
 * dialog (Playwright dismisses them, like those browsers) and fails if one
 * shows up at all.
 */

import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const API = process.env.API_URL ?? 'http://localhost:8765'
const MEAL_ORDER = ['breakfast', 'lunch', 'snack', 'dinner'] as const
const MEAL_LABEL: Record<string, string> = { breakfast: 'desayuno', lunch: 'comida', snack: 'merienda', dinner: 'cena' }

type Slot = { dishes?: { kind: string; recipeId?: string }[] }
type Menu = { id: string; days: Record<string, Slot>[]; skippedDays?: number[] }

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

async function fetchMenu(page: Page): Promise<Menu> {
  const { headers, userId } = await session(page)
  return (await page.request.get(`${API}/menu/${userId}/${thisMonday()}`, { headers })).json()
}

/** First meal (chronologically) of the day holding a recipe — the hero. */
function featured(day: Record<string, Slot>): { meal: string; recipeId: string } | null {
  for (const meal of MEAL_ORDER) {
    const r = day?.[meal]?.dishes?.find((d) => d.kind === 'recipe')
    if (r?.recipeId) return { meal, recipeId: r.recipeId }
  }
  return null
}

test('skip day, remove a meal and ban a recipe confirm in the app sheet, without browser dialogs', async ({ page }) => {
  test.setTimeout(120_000)
  const nativeDialogs: string[] = []
  page.on('dialog', (d) => {
    nativeDialogs.push(d.message())
    void d.dismiss()
  })

  await registerFreshUser(page)
  await completeOnboarding(page)
  const { headers, userId } = await session(page)
  const gen = await page.request.post(`${API}/menu/generate`, {
    headers,
    data: { userId, weekStart: thisMonday(), force: true },
  })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()

  const todayIdx = (new Date().getDay() + 6) % 7
  const first = featured((await fetchMenu(page)).days[todayIdx])
  test.skip(!first, 'the generator left today without recipes (empty catalogue?)')

  await page.goto('/menu')
  const hero = page.getByTestId('menu-hero')
  await expect(hero).toBeVisible({ timeout: 20_000 })

  // ── «Vetar esta receta» → confirm → the hero gets another recipe.
  await hero.getByRole('button', { name: /más opciones/i }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^vetar esta receta$/i }).click()
  const banSheet = page.getByRole('dialog')
  await expect(banSheet.getByRole('button', { name: /^cancelar$/i })).toBeVisible()
  await banSheet.getByRole('button', { name: /^vetar$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect
    .poll(async () => (await fetchMenu(page)).days[todayIdx]?.[first!.meal]?.dishes?.[0]?.recipeId, { timeout: 10_000 })
    .not.toBe(first!.recipeId)

  // ── «···» → «Quitar <comida>» → confirm → the meal is gone.
  const label = MEAL_LABEL[first!.meal]
  await hero.getByRole('button', { name: /más opciones/i }).click()
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(`^quitar ${label}$`, 'i') }).click()
  const removeSheet = page.getByRole('dialog')
  await expect(removeSheet.getByRole('button', { name: /^cancelar$/i })).toBeVisible()
  await removeSheet.getByRole('button', { name: /^quitar$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect
    .poll(async () => Boolean((await fetchMenu(page)).days[todayIdx]?.[first!.meal]), { timeout: 10_000 })
    .toBe(false)

  // ── «Cancelar» leaves the day as it was.
  const skip = page.getByRole('button', { name: /^saltar día$/i })
  await skip.click()
  await page.getByRole('dialog').getByRole('button', { name: /^cancelar$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Día marcado sin cocinar.')).toHaveCount(0)

  // ── «Saltar día» → confirm → the day is «sin cocinar».
  await skip.click()
  await page.getByRole('dialog').getByRole('button', { name: /^saltar día$/i }).click()
  await expect(page.getByText('Día marcado sin cocinar.')).toBeVisible({ timeout: 10_000 })

  // All three survive a reload.
  await page.reload()
  await expect(page.getByText('Día marcado sin cocinar.')).toBeVisible({ timeout: 20_000 })
  const after = await fetchMenu(page)
  expect(after.skippedDays ?? []).toContain(todayIdx)
  expect(after.days[todayIdx]?.[first!.meal]).toBeFalsy()

  expect(nativeDialogs, 'the menu must not use window.confirm').toEqual([])
})
