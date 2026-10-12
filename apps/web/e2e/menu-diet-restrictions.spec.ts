/**
 * PRO-61 (hogares de prueba, 2026-10-11/12): a vegetarian got «Costillas a la
 * riojana» and «Ropa vieja del cocido» in her menu, and «Elegir otra receta»
 * offered chicken, salmon and veal. With «vegetariano» saved:
 *   - the generated week has no meat or fish;
 *   - GET /recipes?fitsMe=1 (the picker's list) hides what breaks the diet;
 *   - the «Elegir otra receta» picker shows no meat and says why.
 * The full-catalogue check (every recipe, «vegetariano» and «sin gluten»)
 * is the vitest suite `dietCatalog.test.ts`.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, skipFirstSteps } from './_helpers'

const API = process.env.API_URL ?? 'http://localhost:8765'

// Seed recipes whose meat/fish ingredient exists in the CI ingredient catalog.
const MEAT_OR_FISH = /ternera|albondiga|carriller|pollo|salmon|salmón|atun|atún|cocido|con carne/i

function thisMonday(): string {
  const d = new Date()
  d.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function recipeNames(menu: { days: Record<string, { dishes?: { kind: string; recipeName?: string }[] }>[] }): string[] {
  const out: string[] = []
  for (const day of menu.days ?? []) {
    for (const slot of Object.values(day ?? {})) {
      for (const d of slot?.dishes ?? []) if (d.kind === 'recipe' && d.recipeName) out.push(d.recipeName)
    }
  }
  return out
}

test('vegetarian: no meat in the week, in the picker list or in «Elegir otra receta»', async ({ page }) => {
  test.setTimeout(120_000)
  await registerFreshUser(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const headers = { Authorization: `Bearer ${token}` }

  const onb = await page.request.post(`${API}/user/${userId}/onboarding`, {
    headers,
    data: {
      adults: 1,
      kidsCount: 0,
      cookingFreq: 'daily',
      restrictions: ['vegetariano'],
      healthConsent: true,
      favoriteDishes: ['lentejas'],
      priority: 'healthy',
    },
  })
  expect(onb.ok(), `onboarding: ${onb.status()}`).toBeTruthy()
  await skipFirstSteps(page)
  await page.evaluate(() => {
    const u = JSON.parse(localStorage.getItem('ona_user') ?? '{}')
    u.onboardingDone = true
    localStorage.setItem('ona_user', JSON.stringify(u))
  })

  // The catalogue has meat; the picker's list (fitsMe) does not.
  const all = (await (await page.request.get(`${API}/recipes?perPage=100`, { headers })).json()) as { name: string }[]
  expect(all.some((r) => MEAT_OR_FISH.test(r.name)), 'seed has meat recipes').toBeTruthy()
  const fits = (await (await page.request.get(`${API}/recipes?perPage=100&fitsMe=1`, { headers })).json()) as { name: string }[]
  expect(fits.length).toBeGreaterThan(0)
  expect(fits.filter((r) => MEAT_OR_FISH.test(r.name))).toEqual([])

  // A whole generated week: no meat or fish.
  const weekStart = thisMonday()
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const week = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  expect(recipeNames(week).filter((n) => MEAT_OR_FISH.test(n))).toEqual([])

  // Only today's lunch, so the hero is a (vegetarian) recipe to swap.
  const todayIdx = (new Date().getDay() + 6) % 7
  const customTemplate = Array.from({ length: 7 }, (_, i) => (i === todayIdx ? { lunch: true } : {}))
  const gen2 = await page.request.post(`${API}/menu/generate`, {
    headers,
    data: { userId, weekStart, force: true, customTemplate },
  })
  expect(gen2.ok(), `generate today: ${gen2.status()}`).toBeTruthy()

  await page.goto('/menu')
  const hero = page.getByTestId('menu-hero')
  await expect(hero).toBeVisible({ timeout: 20_000 })
  await hero.getByRole('button', { name: /más opciones/i }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^elegir otra receta$/i }).click()

  const picker = page.getByRole('dialog').filter({ hasText: 'Cambiar plato' })
  await expect(picker.getByTestId('picker-restrictions-note')).toBeVisible()
  const list = picker.locator('ul li')
  await expect(list.first()).toBeVisible({ timeout: 15_000 })
  const shown = await list.allInnerTexts()
  expect(shown.filter((t) => MEAT_OR_FISH.test(t))).toEqual([])
  await picker.getByPlaceholder('Buscar receta…').fill('ternera')
  await expect(picker.getByText(/sin resultados/i)).toBeVisible()
})
