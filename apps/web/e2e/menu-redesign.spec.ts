/**
 * /menu "D · Luz y foto" (2026-10-08). Before, the first screen was header
 * (greeting, Nº, week pill, Día/Semana toggle, strip, progress bar,
 * Compartir/Regenerar) and today's food started ~560 px down; each meal
 * carried 3–6 chips; the tab bar was icons only.
 *
 * Now: today's featured meal is a photo hero with "Empezar a cocinar" (→ cook
 * mode) above the fold, every per-meal action sits behind the meal's "···",
 * the week's actions behind the header "···", and the tab bar has visible
 * labels. On desktop the week columns keep drag & drop between days.
 */

import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const API = process.env.API_URL ?? 'http://localhost:8765'
const MEAL_ORDER = ['breakfast', 'lunch', 'snack', 'dinner']

function thisMonday(): string {
  const d = new Date()
  d.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Register, skip onboarding, generate this week's menu; returns the menu as the API sees it. */
async function userWithMenu(page: Page) {
  await registerFreshUser(page)
  await completeOnboarding(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const weekStart = thisMonday()
  const headers = { Authorization: `Bearer ${token}` }
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const menu = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  return { menu, weekStart }
}

/** Recipe id of the day's featured meal: first meal (chronologically) holding a recipe. */
function featuredRecipeId(day: Record<string, { dishes?: { kind: string; recipeId?: string }[] }>): string | null {
  for (const meal of MEAL_ORDER) {
    const r = day?.[meal]?.dishes?.find((d) => d.kind === 'recipe')
    if (r?.recipeId) return r.recipeId
  }
  return null
}

test("today's first meal is the hero; meal and week actions live in sheets; the tab bar has labels", async ({ page }) => {
  test.setTimeout(90_000)
  const { menu } = await userWithMenu(page)
  const todayIdx = (new Date().getDay() + 6) % 7
  const expectedId = featuredRecipeId(menu.days[todayIdx])
  test.skip(!expectedId, 'the generator left today without recipes (empty catalogue?)')

  await page.goto('/menu')
  const hero = page.getByTestId('menu-hero')
  await expect(hero).toBeVisible({ timeout: 20_000 })

  // The hero is today's featured meal and its CTA opens cook mode for it.
  const cook = hero.getByRole('link', { name: /empezar a cocinar/i })
  await expect(cook).toHaveAttribute('href', new RegExp(`^/recipes/${expectedId}/cook\\?servings=\\d+$`))
  // …above the fold, clear of the tab bar.
  const viewport = page.viewportSize()!
  const box = (await cook.boundingBox())!
  expect(box.y + box.height).toBeLessThan(viewport.height - 70)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Hoy, /)

  // No chip wall on the card: the per-meal actions are behind "···".
  await expect(page.getByRole('button', { name: /^(tipo|vetar)$/i })).toHaveCount(0)
  await hero.getByRole('button', { name: /más opciones/i }).click()
  const mealSheet = page.getByRole('dialog')
  await expect(mealSheet.getByRole('button', { name: /^vetar esta receta$/i })).toBeVisible()
  await expect(mealSheet.getByRole('button', { name: /^elegir otra receta$/i })).toBeVisible()
  await expect(mealSheet.getByRole('button', { name: /más comensales/i })).toBeVisible()

  // A sheet action is wired: "Fijar" locks the slot and the hero says so.
  await mealSheet.getByRole('button', { name: /^fijar$/i }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(hero.getByText('Fijada')).toBeVisible({ timeout: 10_000 })

  // The week's "···" holds the week actions.
  await page.getByRole('button', { name: /opciones de la semana/i }).click()
  const weekSheet = page.getByRole('dialog')
  await expect(weekSheet.getByRole('button', { name: /^regenerar semana$/i })).toBeVisible()
  await expect(weekSheet.getByRole('button', { name: /^compartir$/i })).toBeVisible()
  await expect(weekSheet.getByRole('button', { name: /^vista semana$/i })).toBeVisible()
  await expect(weekSheet.getByRole('link', { name: /^historial$/i })).toHaveAttribute('href', '/menu/history')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Bottom tab bar: visible text labels, active tab marked.
  const nav = page.getByRole('navigation', { name: 'Navegación principal' })
  for (const label of ['Menú', 'Compra', 'Recetas', 'Perfil']) {
    await expect(nav.getByText(label, { exact: true })).toBeVisible()
  }
  // Mimo is the floating button, not a tab (D-023).
  await expect(nav.getByText('Asesor', { exact: true })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: 'Menú' })).toHaveAttribute('aria-current', 'page')
})

const MENU_GET = /\/menu\/[0-9a-f-]{36}\/\d{4}-\d{2}-\d{2}$/

/** Serve the week with today's featured dish stripped of its photo; returns that dish's name. */
async function featuredWithoutPhoto(page: Page, menu: { days: Record<string, any>[] }): Promise<string | null> {
  const todayIdx = (new Date().getDay() + 6) % 7
  const meal = MEAL_ORDER.find((m) => menu.days[todayIdx]?.[m]?.dishes?.some((d: any) => d.kind === 'recipe'))
  if (!meal) return null
  const dish = menu.days[todayIdx][meal].dishes.find((d: any) => d.kind === 'recipe')
  await page.route(MENU_GET, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const res = await route.fetch()
    const json = await res.json()
    for (const d of json.days?.[todayIdx]?.[meal]?.dishes ?? []) if (d.recipeId === dish.recipeId) d.imageUrl = null
    await route.fulfill({ response: res, json })
  })
  return dish.recipeName as string
}

/** Photo-less featured meal: one compact card, the name printed once, no tall empty block. */
async function expectCompactHero(page: Page, name: string, maxHeight: number) {
  const hero = page.getByTestId('menu-hero')
  await expect(hero).toBeVisible({ timeout: 20_000 })
  await expect(hero).toHaveAttribute('data-photo', '0')
  await expect(hero.locator('img, [role="img"]')).toHaveCount(0)
  await expect(hero.getByText(name, { exact: true })).toHaveCount(1)
  await expect(hero.getByRole('link', { name: /empezar a cocinar/i })).toBeVisible()
  await expect(hero.getByRole('button', { name: /más opciones/i })).toBeVisible()
  expect((await hero.boundingBox())!.height).toBeLessThan(maxHeight)
}

test('a featured meal without a photo is one compact card with its name once', async ({ page }) => {
  test.setTimeout(90_000)
  const { menu } = await userWithMenu(page)
  const name = await featuredWithoutPhoto(page, menu)
  test.skip(!name, 'the generator left today without recipes')
  await page.goto('/menu')
  await expectCompactHero(page, name!, 260)
})

test('the day strip switches the day shown', async ({ page }) => {
  test.setTimeout(90_000)
  const { menu } = await userWithMenu(page)
  const todayIdx = (new Date().getDay() + 6) % 7
  const other = todayIdx === 0 ? 1 : 0
  const expectedId = featuredRecipeId(menu.days[other])
  test.skip(!expectedId, 'no recipe on the other day')

  await page.goto('/menu')
  await expect(page.getByTestId('menu-hero')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('navigation', { name: 'Días de la semana' }).getByRole('button').nth(other).click()
  await expect(page.getByTestId('menu-hero').getByRole('link', { name: /empezar a cocinar/i })).toHaveAttribute(
    'href',
    new RegExp(`^/recipes/${expectedId}/cook`),
  )
})

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('a featured meal without a photo is a compact card, not a 420 px empty block', async ({ page }) => {
    test.setTimeout(90_000)
    const { menu } = await userWithMenu(page)
    const name = await featuredWithoutPhoto(page, menu)
    test.skip(!name, 'the generator left today without recipes')
    await page.goto('/menu')
    await expectCompactHero(page, name!, 330)
  })

  test('dragging a dish onto another day swaps the two slots', async ({ page }) => {
    test.setTimeout(90_000)
    const { menu } = await userWithMenu(page)
    const mon = menu.days[0]?.lunch?.dishes?.[0]?.recipeName as string | undefined
    const tue = menu.days[1]?.lunch?.dishes?.[0]?.recipeName as string | undefined
    test.skip(!mon || !tue, 'Monday/Tuesday lunch not generated')

    await page.goto('/menu')
    const columns = page.getByTestId('week-columns')
    await expect(columns).toBeVisible({ timeout: 20_000 })
    const source = page.locator('[data-day-column="0"] [aria-roledescription="plato arrastrable"]').first()
    const target = page.locator('[data-day-column="1"] [aria-roledescription="plato arrastrable"]').first()
    await expect(source).toContainText(mon!)
    await expect(target).toContainText(tue!)

    // Centre the week so the drag stays clear of dnd-kit's edge auto-scroll.
    await columns.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    const moved = page.waitForResponse(
      (r) => r.url().endsWith('/move-slot') && r.request().method() === 'POST',
    )
    const s = (await source.boundingBox())!
    const t = (await target.boundingBox())!
    await page.mouse.move(s.x + s.width / 2, s.y + 40)
    await page.mouse.down()
    await page.mouse.move(s.x + s.width / 2 + 20, s.y + 50, { steps: 5 })
    await page.mouse.move(t.x + t.width / 2, t.y + 40, { steps: 12 })
    await page.mouse.up()
    const res = await moved
    expect(res.ok()).toBeTruthy()
    expect(JSON.parse(res.request().postData() ?? '{}')).toEqual({ fromDay: 0, fromMeal: 'lunch', toDay: 1, toMeal: 'lunch' })

    await expect(source).toContainText(tue!, { timeout: 10_000 })
    await expect(target).toContainText(mon!)
  })
})
