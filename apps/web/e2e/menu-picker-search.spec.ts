/**
 * 2026-11-03: «Butifarra con judías» showed up in the recipe search but not
 * in «Elegir otra receta». The picker loaded one page of the catalogue (the
 * API caps it at 100 of ~390; the newest come last) and searched inside it.
 * With more than 100 recipes, searching the picker must find the newest one.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, skipFirstSteps, uniqueId } from './_helpers'
import { madridTodayIdx, pinClock } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'

test('«Elegir otra receta» finds a recipe beyond the first 100', async ({ page }) => {
  test.setTimeout(180_000)
  const day = await pinClock(page, madridTodayIdx())
  await registerFreshUser(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const headers = { Authorization: `Bearer ${token}` }

  const onb = await page.request.post(`${API}/user/${userId}/onboarding`, {
    headers,
    data: { adults: 1, kidsCount: 0, cookingFreq: 'daily', restrictions: [], healthConsent: true, priority: 'healthy' },
  })
  expect(onb.ok(), `onboarding: ${onb.status()}`).toBeTruthy()
  await skipFirstSteps(page)
  await page.evaluate(() => {
    const u = JSON.parse(localStorage.getItem('ona_user') ?? '{}')
    u.onboardingDone = true
    localStorage.setItem('ona_user', JSON.stringify(u))
  })

  // 101 recipes of our own on top of the seed: the last one created is
  // listed last, past the API's first page.
  const found: Array<{ id: string; name: string }> = await (
    await page.request.get(`${API}/ingredients?search=ajo&perPage=50`)
  ).json()
  const ajo = found.find((i) => i.name === 'ajo')
  expect(ajo, 'seed has «ajo»').toBeTruthy()
  const tag = uniqueId().slice(-6)
  const create = (name: string) =>
    page.request.post(`${API}/recipes?force=1`, {
      headers,
      data: {
        name,
        servings: 2,
        meals: ['lunch'],
        seasons: ['spring', 'summer', 'autumn', 'winter'],
        ingredients: [{ ingredientId: ajo!.id, quantity: 10, unit: 'g' }],
        steps: [{ index: 0, text: 'Pica el ajo.' }],
      },
    })
  for (let batch = 0; batch < 10; batch++) {
    const res = await Promise.all(
      Array.from({ length: 10 }, (_, i) => create(`Relleno ${tag} ${batch * 10 + i}`)),
    )
    for (const r of res) expect(r.status(), await r.text()).toBe(201)
  }
  const target = `Butifarra de prueba ${tag}`
  expect((await create(target)).status()).toBe(201)

  const page1 = await page.request.get(`${API}/recipes?perPage=100&fitsMe=1`, { headers })
  expect(Number(page1.headers()['x-total-count'])).toBeGreaterThan(100)
  expect(((await page1.json()) as { name: string }[]).some((r) => r.name === target), 'target is past page 1').toBe(false)

  // Only today's lunch, so the hero is a recipe to swap.
  const { weekStart, dayIdx: todayIdx } = day
  const customTemplate = Array.from({ length: 7 }, (_, i) => (i === todayIdx ? { lunch: true } : {}))
  const gen = await page.request.post(`${API}/menu/generate`, {
    headers,
    data: { userId, weekStart, force: true, customTemplate },
  })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()

  await page.goto('/menu')
  const hero = page.getByTestId('menu-hero')
  await expect(hero).toBeVisible({ timeout: 20_000 })
  await hero.getByRole('button', { name: /más opciones/i }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^cambiar plato$/i }).click()

  const picker = page.getByRole('dialog').filter({ hasText: 'Cambiar plato' })
  await expect(picker.locator('ul li').first()).toBeVisible({ timeout: 15_000 })
  await picker.getByPlaceholder('Buscar receta…').fill(`butifarra de prueba ${tag}`)
  // A row of the list (the «Usar "…" como plato» button also holds the text).
  await expect(picker.locator('ul li').filter({ hasText: target })).toBeVisible({ timeout: 15_000 })
  await expect(picker.getByText(/sin resultados/i)).toHaveCount(0)
})
