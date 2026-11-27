/**
 * PRO-1346 — Tocar una receta la abre (specs/recipes.md: la ficha se abre
 * desde el menú, Recetas y Mis recetas). On staging every tap on a recipe
 * (the menu's dish, «Ver receta», a «Mis recetas» card, a catalogue card)
 * left «Application error» and `TypeError: e is not iterable` in the console
 * while opening the URL directly worked. On the phone, with the recipe photos
 * failing to load, each of the four taps shows the recipe with no page error.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, menuWithRecipesOn, registerFreshUser } from './_helpers'
import { madridMondayIn } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { headers: { Authorization: `Bearer ${token}` }, userId }
}

/** The recipe page is on screen: its name as the heading and the «Empezar a cocinar» bar. */
async function expectRecipe(page: Page, name: string) {
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}(\?|$)/, { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: new RegExp(escape(name), 'i') }).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/Empezar a cocinar/).first()).toBeVisible()
  await expect(page.getByText(/Application error/)).toHaveCount(0)
}

test('tocar un plato del menú, «Ver receta», Mis recetas y el catálogo abre la receta', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && /not iterable|client-side exception|hydrat/i.test(m.text())) errors.push(m.text())
  })
  // The photos don't load (the households' proxy cut them): the page still opens.
  await page.route(/\.(?:jpe?g|png|webp|avif)(?:\?.*)?$/i, (route) => route.abort())

  await registerFreshUser(page)
  await completeOnboarding(page)
  const { headers, userId } = await session(page)
  const weekStart = madridMondayIn(0)
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const today = (new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' })).getDay() + 6) % 7
  const menu = await menuWithRecipesOn(page, headers, userId, weekStart, [[today, 'lunch'], [today, 'dinner']])
  const dishes = ['lunch', 'dinner']
    .map((meal) => menu.days[today][meal]?.dishes?.find((d: { kind: string }) => d.kind === 'recipe'))
    .filter(Boolean) as Array<{ recipeId: string; recipeName: string }>
  expect(dishes.length).toBeGreaterThan(0)

  // A recipe of their own, for «Mis recetas».
  const base = await (await page.request.get(`${API}/recipes/${dishes[0].recipeId}`, { headers })).json()
  const { ingredientId, ingredientName } = base.ingredients.find((i: { ingredientId?: string }) => i.ingredientId)
  const mine = `Receta propia ${Date.now()}`
  const created = await page.request.post(`${API}/recipes`, {
    headers,
    data: {
      name: mine,
      servings: 2,
      meals: ['dinner'],
      seasons: ['autumn'],
      equipment: ['sartén'],
      ingredients: [{ ingredientId, quantity: 100, unit: 'g' }],
      steps: [{ index: 0, text: `Saltea la ${ingredientName} y sirve.` }],
      force: true,
    },
  })
  expect(created.status(), await created.text()).toBe(201)

  // 1 · The dish in today's menu.
  await page.goto('/menu')
  const dish = dishes[0].recipeName
  await page.getByRole('link', { name: new RegExp(escape(dish)) }).first().click()
  await expectRecipe(page, dish)

  // 2 · «Ver receta» in the meal's «···» sheet.
  await page.goto('/menu')
  await page.getByRole('button', { name: /^Más opciones de comida/ }).first().click()
  await page.getByRole('link', { name: 'Ver receta' }).click()
  await expect(page).toHaveURL(/\/recipes\//, { timeout: 20_000 })
  await expect(page.getByText(/Empezar a cocinar/).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/Application error/)).toHaveCount(0)

  // 3 · A card in «Mis recetas».
  await page.goto('/recipes/mias')
  await page.getByRole('main').getByRole('link', { name: new RegExp(escape(mine)) }).first().click()
  await expectRecipe(page, mine)

  // 4 · A card in the catalogue.
  await page.goto('/recipes')
  const card = page
    .getByRole('main')
    .locator('a[href^="/recipes/"]:not([href="/recipes/new"]):not([href="/recipes/mias"]):not([href="/recipes/recetarios"])')
    .first()
  await expect(card).toBeVisible({ timeout: 15_000 })
  await card.click()
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}(\?|$)/, { timeout: 20_000 })
  await expect(page.getByText(/Empezar a cocinar/).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/Application error/)).toHaveCount(0)

  expect(errors, 'page errors').toEqual([])
})
