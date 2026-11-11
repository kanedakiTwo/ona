/**
 * /menu, Miguel on desktop (2026-11-10):
 *   1. «Hago cambios sobre el menú y tardan mucho en mostrarse en pantalla,
 *      por ejemplo elegir una receta o crear una nota» → the change is drawn
 *      before the API answers (optimistic, lib/menuOptimistic.ts) and goes
 *      back, with a notice, when it fails.
 *   2. «Si le doy a "no hay", sigue volviendo a hacer scroll up a la receta
 *      del día» → the «no hay» cell of «La semana» opens «Comida · viernes —
 *      Sin plato todavía» for that day and meal, without moving the page.
 *   3. «Si hay más de un plato en una comida, no aparece… una nota de
 *      Romanescu que no se ve» → every dish shows, in the hero, the side
 *      meals, the week cells and the phone's day view; a meal with three
 *      dishes makes its row taller for every day, so the dinner row stays on
 *      one line.
 *   4. «Lo de ver lo del día siguiente… empuja para abajo el menú de la
 *      semana» → no next-day preview.
 *   5. «El buscador debe ir abajo y los resultados encima» → the picker's
 *      search field stays put whatever the number of results.
 */

import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'
import { pinClock } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'
const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

test.use({ timezoneId: 'Europe/Madrid' })

type Dish = { kind: 'recipe'; recipeId: string; recipeName?: string } | { kind: 'note'; text: string }
type Week = { id: string; userId: string; weekStart: string; days: Record<string, { dishes?: Dish[] } | undefined>[] }

/** A user whose week has a recipe at lunch and dinner every day. */
async function userWithFullWeek(page: Page) {
  const day = await pinClock(page)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const headers = { Authorization: `Bearer ${token}` }
  const { weekStart } = day
  const customTemplate = Array.from({ length: 7 }, () => ({ lunch: true, dinner: true }))
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true, customTemplate } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const recipes: { id: string; name: string }[] = await (await page.request.get(`${API}/recipes?perPage=100&fitsMe=1`, { headers })).json()
  expect(recipes.length, 'seeded catalogue').toBeGreaterThan(3)
  let week: Week = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  for (let d = 0; d < 7; d++) {
    for (const meal of ['lunch', 'dinner']) {
      if (week.days[d]?.[meal]?.dishes?.some((x) => x.kind === 'recipe')) continue
      if (week.days[d]?.[meal]) await page.request.delete(`${API}/menu/${week.id}/day/${d}/meal/${meal}`, { headers })
      const r = await page.request.post(`${API}/menu/${week.id}/day/${d}/meal/${meal}`, {
        headers,
        data: { recipeId: recipes[(d * 2 + (meal === 'lunch' ? 0 : 1)) % recipes.length].id },
      })
      expect(r.ok(), `fill ${d} ${meal}: ${r.status()}`).toBeTruthy()
    }
  }
  week = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  return { week, headers, recipes, d: day.dayIdx }
}

const addNote = (page: Page, headers: Record<string, string>, week: Week, d: number, meal: string, text: string) =>
  page.request.post(`${API}/menu/${week.id}/day/${d}/meal/${meal}/dish`, { headers, data: { kind: 'note', text } })

/** How far the page is scrolled: the window plus every scrolling box around «La semana» (the app shell scrolls its own box). */
const scrolled = (page: Page) =>
  page.getByTestId('week-columns').evaluate((el) => {
    let y = window.scrollY
    for (let n = el.parentElement; n; n = n.parentElement) y += n.scrollTop
    return y
  })

const recipeName = (week: Week, d: number, meal: string) =>
  (week.days[d]?.[meal]?.dishes?.find((x) => x.kind === 'recipe') as { recipeName?: string } | undefined)?.recipeName ?? ''

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('«no hay» in «La semana» opens that meal\'s sheet without moving the page; no next-day preview', async ({ page }) => {
    test.setTimeout(120_000)
    const { week, headers, d } = await userWithFullWeek(page)
    const other = d === 0 ? 1 : 0
    const del = await page.request.delete(`${API}/menu/${week.id}/day/${other}/meal/lunch`, { headers })
    expect(del.ok(), `delete lunch: ${del.status()}`).toBeTruthy()

    await page.goto(`/menu?day=${d}`)
    await expect(page.getByTestId('week-columns')).toBeVisible({ timeout: 20_000 })
    // Point 4: the preview of the next day is gone.
    await expect(page.getByTestId('next-day-preview')).toHaveCount(0)
    await expect(page.getByText(/^Mañana, /)).toHaveCount(0)

    const noLunch = page.locator(`[data-week-cell="${other}-lunch"] [data-absent-meal="lunch"]`)
    await expect(noLunch).toHaveText('no hay')
    // «La semana» in the middle of the screen: the hero row is above, off screen.
    await page.getByTestId('week-columns').evaluate((el) => el.scrollIntoView({ block: 'end' }))
    await page.waitForTimeout(300)
    const heading = await page.getByRole('heading', { level: 1 }).textContent()
    const before = await scrolled(page)
    expect(before).toBeGreaterThan(50)

    await noLunch.click()
    const sheet = page.getByRole('dialog', { name: 'Sin plato todavía' })
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText(`Comida · ${WEEKDAYS[other]}`)
    await expect(sheet.getByRole('button', { name: /^elegir receta/i })).toBeVisible()
    await expect(sheet.getByRole('button', { name: /^una al azar/i })).toBeVisible()
    await expect(sheet.getByRole('button', { name: /^del congelador/i })).toBeVisible()
    await expect(sheet.getByRole('button', { name: /^táper de la nevera/i })).toBeVisible()
    await page.waitForTimeout(400)
    expect(await scrolled(page)).toBe(before)
    // Neither the day shown above changes.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading ?? '')

    // «Una al azar» fills that day's lunch, still without moving.
    const added = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/menu/${week.id}/day/${other}/meal/lunch`))
    await sheet.getByRole('button', { name: /^una al azar/i }).click()
    expect((await added).ok()).toBeTruthy()
    await expect(noLunch).toHaveCount(0, { timeout: 10_000 })
    expect(await scrolled(page)).toBe(before)
  })

  test('a meal with three dishes shows them all, and the dinner row stays on one line', async ({ page }) => {
    test.setTimeout(120_000)
    const { week, headers, d } = await userWithFullWeek(page)
    for (const text of ['Romanescu', 'Pan de pueblo']) expect((await addNote(page, headers, week, d, 'lunch', text)).ok()).toBeTruthy()
    expect((await addNote(page, headers, week, d, 'dinner', 'Ensalada verde')).ok()).toBeTruthy()

    await page.goto(`/menu?day=${d}`)
    const hero = page.getByTestId('menu-hero')
    await expect(hero).toBeVisible({ timeout: 20_000 })
    // The hero: the recipe big, the two written dishes as lines with «Quitar».
    await expect(hero.getByRole('heading', { level: 2 })).toHaveText(recipeName(week, d, 'lunch'))
    await expect(hero.locator('[data-extra-dish="Romanescu"]')).toBeVisible()
    await expect(hero.locator('[data-extra-dish="Pan de pueblo"]')).toBeVisible()
    await expect(hero.getByRole('button', { name: 'Quitar «Romanescu»' })).toBeVisible()
    // The side meal (dinner) too.
    await expect(page.locator(`[data-dnd-slot="${d}-dinner"] [data-extra-dish="Ensalada verde"]`)).toBeVisible()
    // «La semana»: the cell lists them under the recipe.
    const cell = page.locator(`[data-week-cell="${d}-lunch"]`)
    await expect(cell).toContainText(recipeName(week, d, 'lunch'))
    await expect(cell.locator('[data-extra-dish="Romanescu"]')).toBeVisible()
    await expect(cell.locator('[data-extra-dish="Pan de pueblo"]')).toBeVisible()
    await expect(page.locator(`[data-week-cell="${d}-dinner"] [data-extra-dish="Ensalada verde"]`)).toBeVisible()

    // Every day's dinner starts on the same line, below the tallest lunch.
    const tops: number[] = []
    for (let i = 0; i < 7; i++) tops.push((await page.locator(`[data-week-cell="${i}-dinner"]`).boundingBox())!.y)
    for (const t of tops) expect(Math.abs(t - tops[0])).toBeLessThanOrEqual(1)
    const lunch = (await cell.boundingBox())!
    expect(lunch.y + lunch.height).toBeLessThanOrEqual(tops[0] + 1)

    // «Quitar» takes the line away.
    await hero.getByRole('button', { name: 'Quitar «Pan de pueblo»' }).click()
    await expect(hero.locator('[data-extra-dish="Pan de pueblo"]')).toHaveCount(0)
    await expect(cell.locator('[data-extra-dish="Pan de pueblo"]')).toHaveCount(0)
  })

  test('choosing a recipe and writing a note show before the API answers', async ({ page }) => {
    test.setTimeout(120_000)
    const { week, recipes, d } = await userWithFullWeek(page)
    const current = recipeName(week, d, 'lunch')
    const target = recipes.find((r) => r.name !== current && !Object.values(week.days[d] ?? {}).some((s) => s?.dishes?.some((x) => x.kind === 'recipe' && x.recipeId === r.id)))!

    // Every change of the menu waits 4 s on the server side.
    const release: (() => void)[] = []
    let holding = true
    await page.route(new RegExp(`/menu/${week.id}/day/`), async (route) => {
      if (holding && route.request().method() !== 'GET') await new Promise<void>((r) => release.push(r))
      await route.continue()
    })

    await page.goto(`/menu?day=${d}`)
    const hero = page.getByTestId('menu-hero')
    await expect(hero).toBeVisible({ timeout: 20_000 })
    await hero.getByRole('button', { name: /más opciones de comida/i }).click()
    await page.getByRole('dialog').getByRole('button', { name: /^elegir otra receta$/i }).click()
    const picker = page.getByTestId('recipe-picker')
    await picker.getByPlaceholder('Buscar receta…').fill(target.name)
    // The list row: its name, then «Mimoia» / «tuya» (a name with «(» or «+» must not break a RegExp).
    await picker.locator('ul li button').filter({ hasText: target.name }).first().click()
    // On screen while the request is still held.
    await expect(hero.getByRole('heading', { level: 2 })).toHaveText(target.name, { timeout: 1_500 })
    expect(release.length).toBe(1)

    await hero.getByRole('button', { name: /más opciones de comida/i }).click()
    await page.getByRole('dialog').getByRole('button', { name: /^añadir plato$/i }).click()
    await page.getByRole('button', { name: /añadir nota/i }).click()
    await page.getByPlaceholder('Pan con tomate').fill('Romanescu')
    await page.getByRole('button', { name: 'Añadir', exact: true }).click()
    await expect(hero.locator('[data-extra-dish="Romanescu"]')).toBeVisible({ timeout: 1_500 })
    // The recipe is still held; the note waits behind it (one queue, so the
    // second write can't wipe out the first).
    expect(release.length).toBe(1)

    // Let them through: the server's week keeps both.
    holding = false
    for (const r of release.splice(0)) r()
    await page.waitForLoadState('networkidle')
    await expect(hero.getByRole('heading', { level: 2 })).toHaveText(target.name)
    await expect(hero.locator('[data-extra-dish="Romanescu"]')).toBeVisible()
  })

  test('a change the API refuses goes back, and the page says so', async ({ page }) => {
    test.setTimeout(120_000)
    const { week, d } = await userWithFullWeek(page)
    await page.route(new RegExp(`/menu/${week.id}/day/${d}/meal/lunch/dish$`), async (route) => {
      await new Promise((r) => setTimeout(r, 1_000))
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' })
    })
    await page.goto(`/menu?day=${d}`)
    const hero = page.getByTestId('menu-hero')
    await expect(hero).toBeVisible({ timeout: 20_000 })
    await hero.getByRole('button', { name: /más opciones de comida/i }).click()
    await page.getByRole('dialog').getByRole('button', { name: /^añadir plato$/i }).click()
    await page.getByRole('button', { name: /añadir nota/i }).click()
    await page.getByPlaceholder('Pan con tomate').fill('Romanescu')
    await page.getByRole('button', { name: 'Añadir', exact: true }).click()
    await expect(hero.locator('[data-extra-dish="Romanescu"]')).toBeVisible({ timeout: 900 })
    await expect(page.getByTestId('menu-change-failed')).toContainText('No se ha podido guardar el cambio', { timeout: 10_000 })
    await expect(hero.locator('[data-extra-dish="Romanescu"]')).toHaveCount(0)
  })

  // 2026-11-10 review of the queue of changes.
  test.describe('the queue of changes', () => {
    async function lunchWithThreeDishes(page: Page) {
      const ctx = await userWithFullWeek(page)
      for (const text of ['Romanescu', 'Pan']) expect((await addNote(page, ctx.headers, ctx.week, ctx.d, 'lunch', text)).ok()).toBeTruthy()
      return ctx
    }
    const serverLunch = async (page: Page, headers: Record<string, string>, week: Week, d: number) => {
      const w: Week = await (await page.request.get(`${API}/menu/${week.userId}/${week.weekStart}`, { headers })).json()
      return (w.days[d]?.lunch?.dishes ?? []).map((x) => (x.kind === 'note' ? x.text : 'receta'))
    }

    test('one fails: the ones behind it go back with it, never sent, and the page says how many', async ({ page }) => {
      test.setTimeout(120_000)
      const { week, headers, d } = await lunchWithThreeDishes(page)
      // The first «Quitar» (Romanescu, position 1) fails after a while.
      let first = true
      await page.route(new RegExp(`/menu/${week.id}/day/${d}/meal/lunch/dish/\\d+`), async (route) => {
        if (route.request().method() === 'DELETE' && first) {
          first = false
          await new Promise((r) => setTimeout(r, 1_500))
          return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' })
        }
        await route.continue()
      })
      await page.goto(`/menu?day=${d}`)
      const hero = page.getByTestId('menu-hero')
      await expect(hero.locator('[data-extra-dish="Pan"]')).toBeVisible({ timeout: 20_000 })
      await hero.getByRole('button', { name: 'Quitar «Romanescu»' }).click()
      // On screen Pan is now position 1: removing it is queued behind.
      await hero.getByRole('button', { name: 'Quitar «Pan»' }).click()
      await expect(page.getByTestId('menu-change-failed')).toContainText('he deshecho 2 cambios', { timeout: 10_000 })
      await expect(hero.locator('[data-extra-dish="Romanescu"]')).toBeVisible()
      await expect(hero.locator('[data-extra-dish="Pan"]')).toBeVisible()
      await page.waitForLoadState('networkidle')
      // The server removed nothing: «Quitar Pan» (position 1) never reached it to take Romanescu.
      expect(await serverLunch(page, headers, week, d)).toEqual(['receta', 'Romanescu', 'Pan'])
    })

    test('a request that never answers gives up after 20 s and goes back', async ({ page }) => {
      test.setTimeout(120_000)
      const { week, d } = await lunchWithThreeDishes(page)
      await page.route(new RegExp(`/menu/${week.id}/day/${d}/meal/lunch/dish/\\d+`), async (route) => {
        if (route.request().method() === 'DELETE') return new Promise<void>(() => {})
        await route.continue()
      })
      await page.goto(`/menu?day=${d}`)
      const hero = page.getByTestId('menu-hero')
      await expect(hero.locator('[data-extra-dish="Romanescu"]')).toBeVisible({ timeout: 20_000 })
      await hero.getByRole('button', { name: 'Quitar «Romanescu»' }).click()
      await expect(hero.locator('[data-extra-dish="Romanescu"]')).toHaveCount(0)
      await expect(page.getByTestId('menu-change-failed')).toContainText('No se ha podido guardar el cambio', { timeout: 30_000 })
      await expect(hero.locator('[data-extra-dish="Romanescu"]')).toBeVisible()
    })

    test('coming back to the window while a change is on its way doesn\'t paint the old week', async ({ page }) => {
      test.setTimeout(120_000)
      const { week, headers, d } = await userWithFullWeek(page)
      const release: (() => void)[] = []
      let holding = true
      await page.route(new RegExp(`/menu/${week.id}/day/`), async (route) => {
        if (holding && route.request().method() !== 'GET') await new Promise<void>((r) => release.push(r))
        await route.continue()
      })
      await page.goto(`/menu?day=${d}`)
      const hero = page.getByTestId('menu-hero')
      await expect(hero).toBeVisible({ timeout: 20_000 })
      await page.waitForTimeout(800)
      await hero.getByRole('button', { name: /más opciones de comida/i }).click()
      await page.getByRole('dialog').getByRole('button', { name: /^añadir plato$/i }).click()
      await page.getByRole('button', { name: /añadir nota/i }).click()
      await page.getByPlaceholder('Pan con tomate').fill('Romanescu')
      await page.getByRole('button', { name: 'Añadir', exact: true }).click()
      await expect(hero.locator('[data-extra-dish="Romanescu"]')).toBeVisible({ timeout: 1_500 })
      expect(release.length).toBe(1)
      // Two minutes later the window gets the focus back: the week is stale.
      const browserNow = await page.evaluate(() => Date.now())
      await page.clock.setFixedTime(new Date(browserNow + 2 * 60_000))
      await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
      await page.waitForTimeout(1_500)
      await expect(hero.locator('[data-extra-dish="Romanescu"]')).toBeVisible()
      const saved = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/day/${d}/meal/lunch/dish`))
      holding = false
      for (const r of release.splice(0)) r()
      expect((await saved).status()).toBe(200)
      await page.waitForLoadState('networkidle')
      await expect(hero.locator('[data-extra-dish="Romanescu"]')).toBeVisible()
      const w: Week = await (await page.request.get(`${API}/menu/${week.userId}/${week.weekStart}`, { headers })).json()
      expect(w.days[d]?.lunch?.dishes?.some((x) => x.kind === 'note' && x.text === 'Romanescu')).toBe(true)
    })

    test('«Usar "…" como plato» is one request and keeps «Solo hoy»', async ({ page }) => {
      test.setTimeout(120_000)
      const { week, headers, d } = await userWithFullWeek(page)
      expect((await page.request.patch(`${API}/menu/${week.id}/day/${d}/meal/lunch`, { headers, data: { servings: 4 } })).ok()).toBeTruthy()
      const writes: string[] = []
      page.on('request', (r) => {
        if (r.method() !== 'GET' && r.url().includes(`/menu/${week.id}/`)) writes.push(`${r.method()} ${new URL(r.url()).pathname}`)
      })
      await page.goto(`/menu?day=${d}`)
      const hero = page.getByTestId('menu-hero')
      await expect(hero).toBeVisible({ timeout: 20_000 })
      await page.waitForTimeout(800)
      await hero.getByRole('button', { name: /más opciones de comida/i }).click()
      await page.getByRole('dialog').getByRole('button', { name: /^elegir otra receta$/i }).click()
      const picker = page.getByTestId('recipe-picker')
      await picker.getByPlaceholder('Buscar receta…').fill('Cenamos fuera esta vez')
      await picker.getByRole('button', { name: /como plato/ }).click()
      await page.waitForLoadState('networkidle')
      expect(writes).toEqual([`PUT /menu/${week.id}/day/${d}/meal/lunch`])
      const w: Week & { days: Record<string, { servings?: number | null } | undefined>[] } = await (
        await page.request.get(`${API}/menu/${week.userId}/${week.weekStart}`, { headers })
      ).json()
      expect(w.days[d]?.lunch?.dishes).toEqual([{ kind: 'note', text: 'Cenamos fuera esta vez' }])
      expect((w.days[d]?.lunch as { servings?: number | null }).servings).toBe(4)
    })
  })
})

/** A recipe whose name no other one contains: searching it gives one result. */
const uniqueName = (recipes: { name: string }[]) =>
  recipes.find((r) => recipes.filter((o) => o.name.toLowerCase().includes(r.name.toLowerCase())).length === 1)!.name

/** The picker's search field doesn't move between many results and few or none (point 5). */
async function expectStillSearchField(page: Page, many: string, one: string) {
  const picker = page.getByTestId('recipe-picker')
  const field = picker.getByPlaceholder('Buscar receta…')
  await expect(picker.locator('ul li').nth(3)).toBeVisible({ timeout: 15_000 })
  const y = async () => (await field.boundingBox())!.y
  const start = await y()
  await field.fill(many)
  await expect(picker.locator('ul li').first()).toBeVisible()
  expect(await y()).toBe(start)
  await field.fill(one)
  await expect(picker.locator('ul li')).toHaveCount(1, { timeout: 10_000 })
  expect(await y()).toBe(start)
  await field.fill('zzzz no existe')
  await expect(picker.getByText(/sin resultados/i)).toBeVisible({ timeout: 10_000 })
  expect(await y()).toBe(start)
  // Below the results, at the bottom of the sheet.
  const list = (await picker.getByTestId('picker-results').boundingBox())!
  expect(start).toBeGreaterThanOrEqual(list.y + list.height - 1)
}

test.describe('phone 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the day view shows every dish of a meal', async ({ page }) => {
    test.setTimeout(120_000)
    const { week, headers, d } = await userWithFullWeek(page)
    expect((await addNote(page, headers, week, d, 'lunch', 'Romanescu')).ok()).toBeTruthy()
    expect((await addNote(page, headers, week, d, 'dinner', 'Ensalada verde')).ok()).toBeTruthy()
    await page.goto(`/menu?day=${d}`)
    const hero = page.getByTestId('menu-hero')
    await expect(hero).toBeVisible({ timeout: 20_000 })
    await expect(hero.getByRole('heading', { level: 2 })).toHaveText(recipeName(week, d, 'lunch'))
    await expect(hero.locator('[data-extra-dish="Romanescu"]')).toBeVisible()
    await expect(hero.getByRole('button', { name: 'Quitar «Romanescu»' })).toBeVisible()
    await expect(page.locator('[data-extra-dish="Ensalada verde"]')).toBeVisible()
    await expect(page.getByText(/^\+ Romanescu$/)).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('the picker\'s search field sits at the bottom and doesn\'t move with the results', async ({ page }) => {
    test.setTimeout(120_000)
    const { recipes, d } = await userWithFullWeek(page)
    await page.goto(`/menu?day=${d}`)
    const hero = page.getByTestId('menu-hero')
    await expect(hero).toBeVisible({ timeout: 20_000 })
    await hero.getByRole('button', { name: /más opciones de comida/i }).click()
    await page.getByRole('dialog').getByRole('button', { name: /^elegir otra receta$/i }).click()
    const sheet = (await page.getByTestId('recipe-picker').boundingBox())!
    const field = (await page.getByTestId('recipe-picker').getByPlaceholder('Buscar receta…').boundingBox())!
    expect(field.y + field.height).toBeLessThanOrEqual(844)
    expect(field.y).toBeGreaterThan(sheet.y + sheet.height / 2)
    await expectStillSearchField(page, 'a', uniqueName(recipes))
  })
})

test.describe('desktop picker', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('the picker\'s search field doesn\'t move with the results', async ({ page }) => {
    test.setTimeout(120_000)
    const { recipes, d } = await userWithFullWeek(page)
    await page.goto(`/menu?day=${d}`)
    const hero = page.getByTestId('menu-hero')
    await expect(hero).toBeVisible({ timeout: 20_000 })
    await hero.getByRole('button', { name: /más opciones de comida/i }).click()
    await page.getByRole('dialog').getByRole('button', { name: /^elegir otra receta$/i }).click()
    await expectStillSearchField(page, 'a', uniqueName(recipes))
  })
})

