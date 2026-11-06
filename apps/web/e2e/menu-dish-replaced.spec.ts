/**
 * PRO-345 · «Revisar los menús guardados cuando cambia una receta». When a
 * recipe changes and no longer fits the household's allergies or diet (or
 * is deleted), the server replaces the dish and marks it `replaced`; the day
 * card says so. Here:
 *   - a generated menu has no such line;
 *   - with `replaced` on the dishes (injected into GET /menu/…, as
 *     `menuRecipeRecheck.ts` writes it), the card shows it.
 *   - PRO-1067: the same card when the review of PRO-364 changed the dish
 *     after someone saved an allergy or diet (`reason: 'restrictions'`).
 * The replacement itself is `menuRecipeRecheck.test.ts` / `.smoke.ts` and
 * `menuRestrictionsReview.test.ts` / `.smoke.ts`.
 */
import { test, expect } from '@playwright/test'
import { menuWithRecipesOn, registerFreshUser, skipFirstSteps } from './_helpers'
import { pinClock } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'

/** GET /menu/… with `replaced` on every recipe dish, as the server writes it. */
async function injectReplaced(page: import('@playwright/test').Page, userId: string, weekStart: string, replaced: { recipeName: string; reason: string }) {
  await page.route(`**/menu/${userId}/${weekStart}`, async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    const days = (body.days ?? []).map((day: Record<string, { dishes?: Array<Record<string, unknown>> }>) =>
      Object.fromEntries(Object.entries(day ?? {}).map(([meal, slot]) => [
        meal,
        slot ? { ...slot, dishes: (slot.dishes ?? []).map((d) => (d.kind === 'recipe' ? { ...d, replaced } : d)) } : slot,
      ])),
    )
    await route.fulfill({ response: res, json: { ...body, days } })
  })
}

test('the day card says which dish was replaced and why', async ({ page }) => {
  test.setTimeout(120_000)
  const { weekStart, dayIdx } = await pinClock(page)
  await registerFreshUser(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const headers = { Authorization: `Bearer ${token}` }
  const onb = await page.request.post(`${API}/user/${userId}/onboarding`, {
    headers,
    data: { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], priority: 'varied' },
  })
  expect(onb.ok(), `onboarding: ${onb.status()}`).toBeTruthy()
  await skipFirstSteps(page)
  await page.evaluate(() => {
    const u = JSON.parse(localStorage.getItem('ona_user') ?? '{}')
    u.onboardingDone = true
    localStorage.setItem('ona_user', JSON.stringify(u))
  })
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  await menuWithRecipesOn(page, headers, userId, weekStart, [[dayIdx, 'lunch']])

  // As generated: nothing replaced.
  await page.goto('/menu')
  await expect(page.getByRole('navigation', { name: 'Días de la semana' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('menu-hero')).toBeVisible()
  await expect(page.getByTestId('dish-replaced')).toHaveCount(0)

  // The fajitas got wheat tortillas: every recipe dish now stands in for them.
  await injectReplaced(page, userId, weekStart, { recipeName: 'Fajitas de pollo', reason: 'diet' })
  await page.reload()
  const line = page.getByTestId('menu-hero').getByTestId('dish-replaced')
  await expect(line).toBeVisible({ timeout: 20_000 })
  await expect(line).toContainText('En lugar de «Fajitas de pollo», que ha cambiado y ya no encaja con vuestra dieta')

  // PRO-1067: someone saved «sin gluten» and the review (PRO-364) changed the pizza.
  await page.unrouteAll({ behavior: 'wait' })
  await injectReplaced(page, userId, weekStart, { recipeName: 'Pizza margarita', reason: 'restrictions' })
  await page.reload()
  await expect(line).toContainText('En lugar de «Pizza margarita», que no encaja con vuestras alergias o dieta', { timeout: 20_000 })
})
