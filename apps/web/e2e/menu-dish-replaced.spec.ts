/**
 * PRO-345 · «Revisar los menús guardados cuando cambia una receta». When a
 * recipe changes and no longer fits the household's allergies or diet (or
 * is deleted), the server replaces the dish and marks it `replaced`; the day
 * card says so. Here:
 *   - a generated menu has no such line;
 *   - with `replaced` on the dishes (injected into GET /menu/…, as
 *     `menuRecipeRecheck.ts` writes it), the card shows it.
 * The replacement itself is `menuRecipeRecheck.test.ts` / `.smoke.ts`.
 */
import { test, expect } from '@playwright/test'
import { menuWithRecipesOn, registerFreshUser, skipFirstSteps } from './_helpers'
import { pinClock } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'

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
  await page.route(`**/menu/${userId}/${weekStart}`, async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    const days = (body.days ?? []).map((day: Record<string, { dishes?: Array<Record<string, unknown>> }>) =>
      Object.fromEntries(Object.entries(day ?? {}).map(([meal, slot]) => [
        meal,
        slot
          ? { ...slot, dishes: (slot.dishes ?? []).map((d) => (d.kind === 'recipe' ? { ...d, replaced: { recipeName: 'Fajitas de pollo', reason: 'diet' } } : d)) }
          : slot,
      ])),
    )
    await route.fulfill({ response: res, json: { ...body, days } })
  })
  await page.reload()
  const line = page.getByTestId('menu-hero').getByTestId('dish-replaced')
  await expect(line).toBeVisible({ timeout: 20_000 })
  await expect(line).toContainText('En lugar de «Fajitas de pollo», que ha cambiado y ya no encaja con vuestra dieta')
})
