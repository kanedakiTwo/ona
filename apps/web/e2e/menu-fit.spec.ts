/**
 * PRO-155 · «El menú dice cuánto ha acertado». The evaluator is a Claude
 * Haiku call; CI has no key, so:
 *   - the real route answers `fit: null` and the page shows no line (the
 *     menu goes out the same without it), and seven favourites are saved
 *     (no cap of five any more);
 *   - with a verdict on the menu (injected into GET /menu/…), the line
 *     appears under the week, and the low one invites to add a recipe.
 * The verdict itself (the real case of 2026-10-16) is `menuFit.test.ts`.
 */
import { test, expect } from '@playwright/test'
import { registerFreshUser, skipFirstSteps } from './_helpers'
import { madridWeekStart } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'

/** This week's Monday in Madrid (the runner is UTC on CI, a week behind on Monday 00:00–02:00). */
const thisMonday = () => madridWeekStart()

const FAVOURITES = ['cremas y sopas', 'carbonara', 'pastel de carne con puré', 'rodaballo al horno', 'croquetas de cocido', 'buñuelos de bacalao', 'chuletón']

test('the line under the menu: none without a verdict, the humble one with a low verdict', async ({ page }) => {
  test.setTimeout(120_000)
  await registerFreshUser(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const headers = { Authorization: `Bearer ${token}` }

  const onb = await page.request.post(`${API}/user/${userId}/onboarding`, {
    headers,
    data: { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], favoriteDishes: FAVOURITES, priority: 'varied' },
  })
  expect(onb.ok(), `onboarding with 7 favourites: ${onb.status()}`).toBeTruthy()
  const me = await (await page.request.get(`${API}/user/${userId}`, { headers })).json()
  expect(me.favoriteDishes ?? me.user?.favoriteDishes).toHaveLength(7)
  await skipFirstSteps(page)
  await page.evaluate(() => {
    const u = JSON.parse(localStorage.getItem('ona_user') ?? '{}')
    u.onboardingDone = true
    localStorage.setItem('ona_user', JSON.stringify(u))
  })

  const weekStart = thisMonday()
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  expect((await gen.json()).fit ?? null).toBeNull()

  await page.goto('/menu')
  await expect(page.getByRole('navigation', { name: 'Días de la semana' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('menu-fit')).toHaveCount(0)

  // Same week, now with a low verdict from the evaluator.
  const fit = {
    score: 5,
    level: 'bajo',
    met: [],
    missed: [
      { preference: 'cremas y sopas', reason: 'no_cabia' },
      { preference: 'carbonara', reason: 'no_catalogo' },
      { preference: 'rodaballo al horno', reason: 'no_catalogo' },
    ],
    unusedAddMethods: ['foto', 'enlace', 'escrita'],
    evaluatedAt: new Date().toISOString(),
  }
  await page.route(`**/menu/${userId}/${weekStart}`, async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    await route.fulfill({ response: res, json: { ...body, fit } })
  })
  await page.reload()
  const line = page.getByTestId('menu-fit')
  await expect(line).toBeVisible({ timeout: 20_000 })
  await expect(line).toHaveAttribute('data-level', 'bajo')
  await expect(line).toContainText('Con las recetas que tengo no me he acercado mucho a lo que os gusta (5 %)')
  await expect(line).toContainText('carbonara y rodaballo al horno')
  await expect(line).not.toContainText('cremas y sopas')
  await expect(line.getByRole('link', { name: 'Añadir una receta' })).toHaveAttribute('href', '/recipes/new')
})
