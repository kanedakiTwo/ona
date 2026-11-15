/**
 * PRO-1109 · «Cocinar ahora» end to end (specs/cook-now.md), against the real
 * API and the seeded catalogue, nothing mocked: the tab → the four questions
 * (editing a pantry quantity) → the proposal → «Cocinar esta» over a planned
 * meal → «Pasarlo a otro día» → cook mode → «Terminar» → /menu with the meal
 * «✓ Comido». cook-now-tab.spec.ts covers the screens with /cook-now/* mocked.
 *
 * No pinClock: the API decides the meal of now with the real clock and the
 * browser has to agree with it. A fresh household has eaten nothing, so there
 * is always a meal of now (lunch until 16:00, then dinner); on Sunday there is
 * no day left to move the planned dish to, so it is taken out instead.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, menuWithRecipesOn, registerFreshUser } from './_helpers'

const API = process.env.API_URL ?? 'http://localhost:8765'
// POST /pantry takes only these units; a recipe line in another one goes in as units.
const BUYABLE = new Set(['g', 'ml', 'u', 'cda', 'cdita', 'kg', 'l'])

async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { headers: { Authorization: `Bearer ${token}` }, userId }
}

type Dish = { kind: string; recipeId?: string }
const recipeIdsOf = (slot: { dishes?: Dish[] } | undefined) =>
  (slot?.dishes ?? []).filter((d) => d.kind === 'recipe').map((d) => d.recipeId!)

test('«Cocinar ahora»: from the four questions to «✓ Comido» in the menu, with the planned dish moved', async ({ page }) => {
  test.setTimeout(180_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const { headers, userId } = await session(page)

  const today = await (await page.request.get(`${API}/cook-now/today`, { headers })).json()
  expect(today.meal, 'a fresh household has a meal of now').not.toBeNull()
  const { weekStart, day, meal } = today as { weekStart: string; day: number; meal: string }

  // The week, with a recipe planned in the meal of now.
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const menu = await menuWithRecipesOn(page, headers, userId, weekStart, [[day, meal]])
  const planned = recipeIdsOf(menu.days[day]?.[meal])
  expect(planned.length).toBeGreaterThan(0)

  // Every ingredient of the week's recipes in the fridge, so «Solo lo que hay»
  // has something to propose with the small CI catalogue.
  const weekRecipeIds = [...new Set<string>(menu.days.flatMap((d: Record<string, { dishes?: Dish[] }> | null) => Object.values(d ?? {}).flatMap(recipeIdsOf)))]
  for (const id of weekRecipeIds) {
    const recipe = await (await page.request.get(`${API}/recipes/${id}`, { headers })).json()
    for (const ing of recipe.ingredients ?? []) {
      const add = await page.request.post(`${API}/pantry`, {
        headers,
        data: {
          name: String(ing.ingredientName).slice(0, 80),
          ingredientId: ing.ingredientId ?? null,
          quantity: 5000,
          unit: BUYABLE.has(ing.unit) ? ing.unit : 'u',
          location: 'nevera',
        },
      })
      expect(add.ok(), `pantry ${ing.ingredientName}: ${add.status()}`).toBeTruthy()
    }
  }

  await page.goto('/cocinar')
  await expect(page.getByTestId('cook-now-today')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /cocinar ahora/i }).click()
  await page.getByRole('button', { name: '1 h o más' }).click()
  await page.getByRole('button', { name: 'Seguir' }).click()
  await page.getByRole('button', { name: 'Solo lo que hay' }).click()
  await expect(page.getByRole('heading', { name: 'Confirma tu despensa' })).toBeVisible({ timeout: 10_000 })

  // Editing a quantity is saved at once.
  const saved = page.waitForResponse((r) => /\/pantry\/[0-9a-f-]{36}$/.test(r.url()) && r.request().method() === 'PATCH')
  await page.getByRole('button', { name: /^Más / }).first().click()
  expect((await saved).ok()).toBeTruthy()

  const proposed = page.waitForResponse((r) => r.url().endsWith('/cook-now/proposal'))
  await page.getByRole('button', { name: 'Proponme una receta' }).click()
  const proposal = await (await proposed).json()
  expect(proposal.items.length, 'with the week in the pantry some recipe comes out').toBeGreaterThan(0)
  expect(proposal.meal).toBe(meal)

  const card = page.getByTestId('cook-now-proposal')
  await expect(card.getByRole('heading', { name: proposal.items[0].recipe.name })).toBeVisible({ timeout: 15_000 })
  await card.getByRole('button', { name: 'Cocinar esta' }).click()

  // The planned dish goes to tomorrow (same meal), or out on Sunday.
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText('¿Y ')
  const chose = page.waitForRequest((r) => r.url().endsWith('/cook-now/choose'))
  if (day < 6) {
    await sheet.getByRole('button', { name: /^Pasarl(o|as) a otro día/ }).click()
    await sheet.getByRole('button', { name: /^Mañana/ }).click()
  } else {
    await sheet.getByRole('button', { name: /^Quitarl(o|as)/ }).click()
  }
  expect((await chose).postDataJSON()).toMatchObject({ recipeId: proposal.items[0].recipe.id, displacedTo: day < 6 ? day + 1 : null })

  // Cook mode for that slot.
  await page.waitForURL(
    (u) => u.pathname === `/recipes/${proposal.items[0].recipe.id}/cook` && u.searchParams.get('menu') === menu.id && u.searchParams.get('meal') === meal,
    { timeout: 20_000 },
  )
  const next = page.getByRole('button', { name: 'Paso siguiente' })
  const finish = page.getByRole('button', { name: /^terminar$/i })
  await expect(next.or(finish)).toBeVisible({ timeout: 15_000 })
  for (let i = 0; i < 40 && !(await finish.isVisible()); i++) await next.click()
  await finish.click()
  // First cook of the household: «¿Qué tal?» first.
  const prompt = page.getByTestId('rating-prompt')
  await expect(prompt.or(page.getByTestId('menu-hero'))).toBeVisible({ timeout: 15_000 })
  if (await prompt.isVisible()) await prompt.getByRole('button', { name: 'Bien' }).click()
  await page.waitForURL((u) => u.pathname === '/menu', { timeout: 15_000 })

  await expect
    .poll(async () => {
      const m = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
      return m.days[day]?.[meal]?.eaten ?? false
    }, { timeout: 10_000 })
    .toBe(true)
  const after = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  expect(recipeIdsOf(after.days[day][meal])).toEqual([proposal.items[0].recipe.id])
  if (day < 6) expect(recipeIdsOf(after.days[day + 1][meal])).toEqual(expect.arrayContaining(planned))
  await expect(page.getByTestId('meal-eaten').first()).toBeVisible({ timeout: 20_000 })
})

test('/profile/pantry goes to the pantry in «Cocinar»', async ({ page }) => {
  await registerFreshUser(page)
  await completeOnboarding(page)
  await page.goto('/profile/pantry')
  await page.waitForURL((u) => u.pathname === '/cocinar', { timeout: 20_000 })
  await expect(page.locator('#despensa')).toContainText('Tu despensa')
})
