/**
 * PRO-259 · «La línea de por qué en cada plato». Only a menu that comes from
 * the planner (menú inteligente) carries a `why` on its dishes; today's
 * generator never does. So:
 *   - a generated menu opens its dish sheet with no «Por qué te lo propongo»;
 *   - with a `why` on the dishes (injected into GET /menu/…, as the planner
 *     will write it), the sheet shows it.
 * What Mimo says when asked is `menuDishWhy.test.ts` (its menu lines).
 */
import { test, expect } from '@playwright/test'
import { menuWithRecipesOn, registerFreshUser, skipFirstSteps } from './_helpers'
import { pinClock } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'
const WHY = 'Lentejas porque os gustan los guisos y hoy tenéis tiempo'

test('the dish sheet shows the why only when the dish carries one', async ({ page }) => {
  test.setTimeout(120_000)
  // «Today» is a fixed weekday of this week (Friday by default) with a lunch:
  // on a weekend the generated menu has nothing on today (PRO-186).
  const { weekStart, dayIdx } = await pinClock(page)
  await registerFreshUser(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const headers = { Authorization: `Bearer ${token}` }
  const onb = await page.request.post(`${API}/user/${userId}/onboarding`, {
    headers,
    data: { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], favoriteDishes: ['lentejas'], priority: 'varied' },
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

  const openFirstDishSheet = async () => {
    await expect(page.getByRole('navigation', { name: 'Días de la semana' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: /^Más opciones de (la )?(comida|cena)/i }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
  }

  // Today's generator: no why.
  await page.goto('/menu')
  await openFirstDishSheet()
  await expect(page.getByTestId('dish-why')).toHaveCount(0)

  // A menu from the planner: every recipe dish with its why.
  await page.route(`**/menu/${userId}/${weekStart}`, async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    const days = (body.days ?? []).map((day: Record<string, { dishes?: Array<Record<string, unknown>> }>) =>
      Object.fromEntries(Object.entries(day ?? {}).map(([meal, slot]) => [
        meal,
        slot ? { ...slot, dishes: (slot.dishes ?? []).map((d) => (d.kind === 'recipe' ? { ...d, why: WHY } : d)) } : slot,
      ])),
    )
    await route.fulfill({ response: res, json: { ...body, days } })
  })
  await page.reload()
  await openFirstDishSheet()
  const why = page.getByTestId('dish-why')
  await expect(why).toBeVisible()
  await expect(why).toContainText('Por qué te lo propongo')
  await expect(why).toContainText(WHY)
})
