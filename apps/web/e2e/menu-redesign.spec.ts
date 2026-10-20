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

import { test, expect, type Locator, type Page } from '@playwright/test'
import { addMealWithRecipe, completeOnboarding, registerFreshUser } from './_helpers'
import { pinClock, pinnedDay } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'
const MEAL_ORDER = ['breakfast', 'lunch', 'snack', 'dinner']

// The browser clock is pinned to one weekday of the current week (Friday by
// default, `E2E_WEEKDAY` to pick another): these specs read «today» and failed
// on weekends, when the generator leaves Saturday and Sunday empty (PRO-186).
test.use({ timezoneId: 'Europe/Madrid' })

const thisMonday = () => pinnedDay().weekStart
/** Index (0 = Monday) of the pinned «today». */
const today = () => pinnedDay().dayIdx

/**
 * Register, skip onboarding, generate this week's menu; returns the menu as
 * the API sees it. The API generates with the server's real date (it may
 * leave the weekend empty), so the days the specs read — the pinned today,
 * Monday and Tuesday — get a lunch when they have no recipe.
 */
async function userWithMenu(page: Page) {
  await pinClock(page)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const weekStart = thisMonday()
  const headers = { Authorization: `Bearer ${token}` }
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const generated = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  for (const d of new Set([today(), 0, 1])) {
    if (featuredRecipeId(generated.days[d])) continue
    if (generated.days[d]?.lunch) await page.request.delete(`${API}/menu/${generated.id}/day/${d}/meal/lunch`, { headers })
    const r = await addMealWithRecipe(page, headers, generated, d, 'lunch')
    expect(r.ok(), `add day ${d} lunch: ${r.status()}`).toBeTruthy()
  }
  const menu = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  return { menu, weekStart, headers }
}

const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

/** Put a recipe in `day`'s `meal` when it has none (the small CI catalogue may need a repeat). */
async function fillSlot(page: Page, headers: Record<string, string>, menu: any, day: number, meal: string) {
  if (menu.days[day]?.[meal]?.dishes?.some((d: { kind: string }) => d.kind === 'recipe')) return
  if (menu.days[day]?.[meal]) await page.request.delete(`${API}/menu/${menu.id}/day/${day}/meal/${meal}`, { headers })
  const r = await addMealWithRecipe(page, headers, menu, day, meal)
  expect(r.ok(), `fill day ${day} ${meal}: ${r.status()}`).toBeTruthy()
}

/**
 * Mouse drag past dnd-kit's 8 px activation. `inWeek` centres «La semana»
 * first, clear of dnd-kit's edge auto-scroll.
 */
async function dragTo(page: Page, source: Locator, target: Locator, { inWeek = true } = {}) {
  if (inWeek) await page.getByTestId('week-columns').evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const s = (await source.boundingBox())!
  const t = (await target.boundingBox())!
  await page.mouse.move(s.x + s.width / 2, s.y + Math.min(40, s.height / 2))
  await page.mouse.down()
  await page.mouse.move(s.x + s.width / 2 + 20, s.y + Math.min(50, s.height / 2) + 10, { steps: 5 })
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 })
  await page.mouse.up()
}

/**
 * A week where lunch is the usual meal (every day has one) except `day`,
 * which only has a dinner: «Comida: no hay» shows in its column.
 */
async function weekWithoutLunchOn(page: Page, day: number) {
  const { menu, headers } = await userWithMenu(page)
  for (let d = 0; d < 7; d++) await fillSlot(page, headers, menu, d, 'lunch')
  await fillSlot(page, headers, menu, day, 'dinner')
  const del = await page.request.delete(`${API}/menu/${menu.id}/day/${day}/meal/lunch`, { headers })
  expect(del.ok(), `delete lunch: ${del.status()}`).toBeTruthy()
  return { menu, headers }
}

const moveSlotResponse = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith('/move-slot') && r.request().method() === 'POST')

/** Some recipe already in the week. */
function anyRecipeId(menu: { days: Record<string, { dishes?: { kind: string; recipeId?: string }[] }>[] }): string | undefined {
  for (const day of menu.days) {
    const id = featuredRecipeId(day)
    if (id) return id
  }
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
  const todayIdx = today()
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
  const todayIdx = today()
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
  const todayIdx = today()
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

  // Miguel, 2026-10-19: clicking Tuesday's dish in «La semana» opened the
  // recipe, so there was no way to see Tuesday the way Monday is shown.
  test('clicking a dish in «La semana» shows that day above, not the recipe', async ({ page }) => {
    test.setTimeout(90_000)
    const { menu } = await userWithMenu(page)
    const other = today() === 0 ? 1 : 0
    const expectedId = featuredRecipeId(menu.days[other])
    test.skip(!expectedId, 'no recipe on the other day')

    await page.goto('/menu')
    await expect(page.getByTestId('week-columns')).toBeVisible({ timeout: 20_000 })
    await page
      .locator(`[data-day-column="${other}"]`)
      .getByRole('button', { name: new RegExp(`ver el ${WEEKDAYS[other]}`, 'i') })
      .first()
      .click()

    await expect(page).toHaveURL(/\/menu(\?.*)?$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(new RegExp(WEEKDAYS[other], 'i'))
    const hero = page.getByTestId('menu-hero')
    await expect(hero.getByRole('link', { name: /empezar a cocinar/i })).toHaveAttribute(
      'href',
      new RegExp(`^/recipes/${expectedId}/cook`),
    )
    // The page scrolls back up so the day is on screen.
    await expect(hero).toBeInViewport()
  })

  // Miguel, 2026-10-19: «Añadir comida» sat under «Mañana, martes», so it
  // read as tomorrow's; it was the selected day's, and nothing said so.
  test('«Añadir comida» sits with the selected day, names it and adds the meal there', async ({ page }) => {
    test.setTimeout(90_000)
    const { menu, headers } = await userWithMenu(page)
    const other = today() === 0 ? 1 : 0
    if (menu.days[other]?.dinner) {
      const del = await page.request.delete(`${API}/menu/${menu.id}/day/${other}/meal/dinner`, { headers })
      expect(del.ok(), `delete dinner: ${del.status()}`).toBeTruthy()
    }

    await page.goto('/menu')
    await expect(page.getByTestId('week-columns')).toBeVisible({ timeout: 20_000 })
    await page
      .locator(`[data-day-column="${other}"]`)
      .getByRole('button', { name: new RegExp(`ver el ${WEEKDAYS[other]}`, 'i') })
      .first()
      .click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText(new RegExp(WEEKDAYS[other], 'i'))

    // Right under the day's meals, before the next day's preview.
    const addMeal = page.getByRole('button', { name: /^añadir comida$/i })
    const box = (await addMeal.boundingBox())!
    const preview = (await page.getByTestId('next-day-preview').boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(preview.y)

    await addMeal.click()
    const sheet = page.getByRole('dialog', { name: `Añadir comida al ${WEEKDAYS[other]}` })
    await expect(sheet).toBeVisible()
    const added = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/menu/${menu.id}/day/${other}/meal/dinner`),
    )
    await sheet.getByRole('button', { name: /^cena$/i }).click()
    expect((await added).ok()).toBeTruthy()
  })

  // Miguel, 2026-10-19: «no se ve que el viernes no hay comida y que la
  // pizza es para cenar» — the tile didn't name its meal and nothing said
  // the lunch was missing.
  test('a day without the week\'s lunch says so, and its tile names the meal', async ({ page }) => {
    test.setTimeout(90_000)
    const { menu, headers } = await userWithMenu(page)
    const other = today() === 0 ? 1 : 0
    const del = await page.request.delete(`${API}/menu/${menu.id}/day/${other}/meal/lunch`, { headers })
    expect(del.ok(), `delete lunch: ${del.status()}`).toBeTruthy()
    const dinnerName = menu.days[other]?.dinner?.dishes?.find((d: { kind: string }) => d.kind === 'recipe')?.recipeName

    await page.goto('/menu')
    const column = page.locator(`[data-day-column="${other}"]`)
    await expect(column.locator('[data-absent-meal="lunch"]')).toHaveText('Comida: no hay', { timeout: 20_000 })
    if (dinnerName) {
      await expect(column.getByRole('button', { name: `Cena: ${dinnerName}. Ver el ${WEEKDAYS[other]}` })).toContainText(/cena/i)
    }

    await column.locator('[data-absent-meal="lunch"]').click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText(new RegExp(WEEKDAYS[other], 'i'))
    const absent = page.locator('[data-testid="absent-meal"][data-meal="lunch"]')
    await expect(absent).toContainText(`El ${WEEKDAYS[other]} no hay comida`)
    const added = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/menu/${menu.id}/day/${other}/meal/lunch`),
    )
    await absent.getByRole('button', { name: `Añadir comida al ${WEEKDAYS[other]}` }).click()
    expect((await added).ok()).toBeTruthy()
    await expect(absent).toHaveCount(0, { timeout: 10_000 })
  })

  // Miguel, 2026-10-19: «no se puede arrastrar de una comida a la cena del
  // mismo día o de otro si no existe; con la cena a la comida pasa lo mismo».
  test('a dinner dragged onto its own day\'s «Comida: no hay» becomes that lunch', async ({ page }) => {
    test.setTimeout(90_000)
    const other = today() === 0 ? 1 : 0
    await weekWithoutLunchOn(page, other)

    await page.goto('/menu')
    const column = page.locator(`[data-day-column="${other}"]`)
    const target = column.locator('[data-absent-meal="lunch"]')
    await expect(target).toBeVisible({ timeout: 20_000 })
    const source = column.locator('[aria-roledescription="plato arrastrable"]').first()
    await expect(source.getByRole('button', { name: /^Cena: / })).toBeVisible()

    const moved = moveSlotResponse(page)
    await dragTo(page, source, target)
    const res = await moved
    expect(res.ok()).toBeTruthy()
    expect(JSON.parse(res.request().postData() ?? '{}')).toEqual({ fromDay: other, fromMeal: 'dinner', toDay: other, toMeal: 'lunch' })
    await expect(source.getByRole('button', { name: /^Comida: / })).toBeVisible({ timeout: 10_000 })
    await expect(target).toHaveCount(0)
  })

  test('a lunch dragged onto another day\'s «Comida: no hay» moves there', async ({ page }) => {
    test.setTimeout(90_000)
    const other = today() === 0 ? 1 : 0
    const from = other === 0 ? 2 : 3
    await weekWithoutLunchOn(page, other)

    await page.goto('/menu')
    const target = page.locator(`[data-day-column="${other}"] [data-absent-meal="lunch"]`)
    await expect(target).toBeVisible({ timeout: 20_000 })
    const source = page.locator(`[data-day-column="${from}"] [aria-roledescription="plato arrastrable"]`).first()
    await expect(source.getByRole('button', { name: /^Comida: / })).toBeVisible()

    const moved = moveSlotResponse(page)
    await dragTo(page, source, target)
    const res = await moved
    expect(res.ok()).toBeTruthy()
    expect(JSON.parse(res.request().postData() ?? '{}')).toEqual({ fromDay: from, fromMeal: 'lunch', toDay: other, toMeal: 'lunch' })
    await expect(page.locator(`[data-day-column="${from}"] [data-absent-meal="lunch"]`)).toBeVisible({ timeout: 10_000 })
  })

  // Miguel, 2026-10-19: «también debería poder arrastrarse del plato
  // principal (comida) al secundario (cena) y viceversa» — the hero row
  // (and the next day's preview) took no part in drag and drop.
  test('in the hero row, the lunch dragged onto the dinner swaps them', async ({ page }) => {
    test.setTimeout(90_000)
    const { menu, headers, weekStart } = await userWithMenu(page)
    const other = today() === 0 ? 1 : 0
    await fillSlot(page, headers, menu, other, 'dinner')
    const filled = await (await page.request.get(`${API}/menu/${menu.userId}/${weekStart}`, { headers })).json()
    const dinnerName = filled.days[other].dinner.dishes.find((d: { kind: string }) => d.kind === 'recipe').recipeName as string

    await page.goto('/menu')
    await page
      .locator(`[data-day-column="${other}"]`)
      .getByRole('button', { name: new RegExp(`ver el ${WEEKDAYS[other]}`, 'i') })
      .first()
      .click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText(new RegExp(WEEKDAYS[other], 'i'))

    const moved = moveSlotResponse(page)
    await dragTo(page, page.locator(`[data-dnd-slot="${other}-lunch"]`), page.locator(`[data-dnd-slot="${other}-dinner"]`), {
      inWeek: false,
    })
    const res = await moved
    expect(res.ok()).toBeTruthy()
    expect(JSON.parse(res.request().postData() ?? '{}')).toEqual({ fromDay: other, fromMeal: 'lunch', toDay: other, toMeal: 'dinner' })
    await expect(page.getByTestId('menu-hero')).toContainText(dinnerName, { timeout: 10_000 })
  })

  test('a dish dragged from the next day\'s preview onto «El … no hay comida» moves there', async ({ page }) => {
    test.setTimeout(90_000)
    const other = today() === 0 ? 1 : 0
    await weekWithoutLunchOn(page, other)

    await page.goto('/menu')
    await page.locator(`[data-day-column="${other}"] [data-absent-meal="lunch"]`).click({ timeout: 20_000 })
    await expect(page.getByRole('heading', { level: 1 })).toContainText(new RegExp(WEEKDAYS[other], 'i'))
    const target = page.locator('[data-testid="absent-meal"][data-meal="lunch"]')
    await expect(target).toBeVisible()

    const moved = moveSlotResponse(page)
    await dragTo(page, page.getByTestId('next-day-preview').locator(`[data-dnd-slot="${other + 1}-lunch"]`), target, { inWeek: false })
    const res = await moved
    expect(res.ok()).toBeTruthy()
    expect(JSON.parse(res.request().postData() ?? '{}')).toEqual({ fromDay: other + 1, fromMeal: 'lunch', toDay: other, toMeal: 'lunch' })
    await expect(target).toHaveCount(0, { timeout: 10_000 })
  })

  // Miguel, 2026-10-19: «al ponerte sobre la cena u otra comida estaría bien
  // que la imagen cambiase a la de ese plato».
  test('hovering a day\'s dinner line shows its photo on the tile', async ({ page }) => {
    test.setTimeout(90_000)
    const { menu, headers } = await userWithMenu(page)
    await fillSlot(page, headers, menu, 0, 'dinner')

    await page.goto('/menu')
    const column = page.locator('[data-day-column="0"]')
    const peek = column.locator('[data-peek="dinner"]')
    await expect(peek).toHaveCSS('opacity', '0', { timeout: 20_000 })
    await column.getByRole('button', { name: /^Cena: / }).hover()
    await expect(peek).toHaveCSS('opacity', '1')
    await page.mouse.move(5, 5)
    await expect(peek).toHaveCSS('opacity', '0')
  })

  // Miguel, 2026-10-19: «el botón de añadir comida no funciona» — with no
  // breakfast recipe that fits, the API answered 404 and nothing showed.
  test('«Añadir comida → Desayuno» always adds it, empty when no breakfast fits', async ({ page }) => {
    test.setTimeout(90_000)
    const { menu, headers } = await userWithMenu(page)
    const other = today() === 0 ? 1 : 0
    if (menu.days[other]?.breakfast) await page.request.delete(`${API}/menu/${menu.id}/day/${other}/meal/breakfast`, { headers })

    await page.goto('/menu')
    await page
      .locator(`[data-day-column="${other}"]`)
      .getByRole('button', { name: new RegExp(`ver el ${WEEKDAYS[other]}`, 'i') })
      .first()
      .click({ timeout: 20_000 })
    await page.getByRole('button', { name: /^añadir comida$/i }).click()
    const sheet = page.getByRole('dialog', { name: `Añadir comida al ${WEEKDAYS[other]}` })
    const added = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/menu/${menu.id}/day/${other}/meal/breakfast`),
    )
    await sheet.getByRole('button', { name: /^desayuno$/i }).click()
    expect((await added).status()).toBe(201)
    await expect(page.locator(`[data-day-column="${other}"]`)).toContainText('Desayuno', { timeout: 10_000 })
  })
})

test('Vista día: a day without the week\'s lunch says «El lunes no hay comida»', async ({ page }) => {
  test.setTimeout(90_000)
  const { menu, headers } = await userWithMenu(page)
  const other = today() === 0 ? 1 : 0
  const del = await page.request.delete(`${API}/menu/${menu.id}/day/${other}/meal/lunch`, { headers })
  expect(del.ok(), `delete lunch: ${del.status()}`).toBeTruthy()

  await page.goto('/menu')
  await expect(page.getByRole('navigation', { name: 'Días de la semana' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('navigation', { name: 'Días de la semana' }).getByRole('button').nth(other).click()
  const absent = page.locator('[data-testid="absent-meal"][data-meal="lunch"]')
  await expect(absent).toContainText(`El ${WEEKDAYS[other]} no hay comida`)
  await expect(absent.getByRole('button', { name: `Añadir comida al ${WEEKDAYS[other]}` })).toBeVisible()
})
