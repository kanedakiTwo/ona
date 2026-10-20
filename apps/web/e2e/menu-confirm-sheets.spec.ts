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
 *
 * The browser clock is pinned to one weekday of the current week (Friday by
 * default, `E2E_WEEKDAY` to pick another — PRO-142): the spec used to read the
 * real «today» and failed from Friday to Sunday.
 */

import { test, expect, type Page } from '@playwright/test'
import { addMealWithRecipe, completeOnboarding, registerFreshUser } from './_helpers'
import { pinClock, pinnedDay } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'
const MEAL_ORDER = ['breakfast', 'lunch', 'snack', 'dinner'] as const
const MEAL_LABEL: Record<string, string> = { breakfast: 'desayuno', lunch: 'comida', snack: 'merienda', dinner: 'cena' }

type Slot = { dishes?: { kind: string; recipeId?: string }[] }
type Menu = { id: string; days: Record<string, Slot>[]; skippedDays?: number[] }

test.use({ timezoneId: 'Europe/Madrid' })

const thisMonday = () => pinnedDay().weekStart

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

  const { dayIdx: todayIdx } = await pinClock(page)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const { headers, userId } = await session(page)
  const gen = await page.request.post(`${API}/menu/generate`, {
    headers,
    data: { userId, weekStart: thisMonday(), force: true },
  })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()

  // The API generates with the server's real date (the weekend after a
  // Friday stays empty, PRO-65), so the spec arranges the week itself:
  // today with lunch and dinner, one other day with its dishes so the week is
  // never empty (an empty week is a different screen), and the rest cleared
  // so the small CI seed catalogue (16 recipes, fewer after PRO-73's quality
  // gate) has free recipes to swap in after a veto, as a real catalogue does.
  const keep = (todayIdx + 1) % 7
  const generated = await fetchMenu(page)
  for (const [d, day] of generated.days.entries()) {
    if (d === todayIdx || d === keep) continue
    for (const meal of Object.keys(day ?? {})) {
      const r = await page.request.delete(`${API}/menu/${generated.id}/day/${d}/meal/${meal}`, { headers })
      expect(r.ok(), `clear day ${d} ${meal}: ${r.status()}`).toBeTruthy()
    }
  }
  for (const [d, meals] of [[todayIdx, ['lunch', 'dinner']], [keep, ['lunch']]] as const) {
    for (const meal of meals) {
      if (featured({ [meal]: generated.days[d]?.[meal] } as Record<string, Slot>)) continue
      if (generated.days[d]?.[meal]) {
        const r = await page.request.delete(`${API}/menu/${generated.id}/day/${d}/meal/${meal}`, { headers })
        expect(r.ok(), `empty day ${d} ${meal}: ${r.status()}`).toBeTruthy()
      }
      const r = await addMealWithRecipe(page, headers, generated, d, meal)
      expect(r.ok(), `add day ${d} ${meal}: ${r.status()}`).toBeTruthy()
    }
  }
  const first = featured((await fetchMenu(page)).days[todayIdx])
  test.skip(!first, 'no recipe for today (empty catalogue?)')

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
