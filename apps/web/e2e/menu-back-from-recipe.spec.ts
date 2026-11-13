/**
 * «Ver receta» from the menu, then «Volver»: back on the menu, on the week
 * and the day you were looking at (Miguel, 2026-11-05). The week lives in
 * `?week=` and the day in `?day=`, both written with replaceState, so the
 * history entry the recipe goes back to carries them.
 * Mobile (390×844).
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, menuWithRecipesOn, registerFreshUser } from './_helpers'
import { madridMondayIn } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { headers: { Authorization: `Bearer ${token}` }, userId }
}

/** Opens /menu on this week and moves to next week's Wednesday with the UI. */
async function nextWeekWednesday(page: Page) {
  await page.goto('/menu')
  await page.getByRole('main').getByRole('button', { name: 'Semana siguiente' }).click()
  const strip = page.getByRole('navigation', { name: 'Días de la semana' })
  await expect(page.getByRole('button', { name: /próxima semana · volver a hoy/i })).toBeVisible({ timeout: 20_000 })
  await strip.getByRole('button').nth(2).click()
  await expect(strip.getByRole('button').nth(2)).toHaveAttribute('aria-pressed', 'true')
  return strip
}

async function expectBackOnWednesday(page: Page, weekStart: string) {
  await expect(page).toHaveURL(new RegExp(`/menu\\?.*week=${weekStart}`), { timeout: 15_000 })
  await expect(page.getByRole('button', { name: /próxima semana · volver a hoy/i })).toBeVisible({ timeout: 15_000 })
  const strip = page.getByRole('navigation', { name: 'Días de la semana' })
  await expect(strip.getByRole('button').nth(2)).toHaveAttribute('aria-pressed', 'true')
}

test('«Volver» from a recipe opened in the menu goes back to that week and day', async ({ page }) => {
  test.setTimeout(150_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const { headers, userId } = await session(page)
  const weekStart = madridMondayIn(1)
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const menu = await menuWithRecipesOn(page, headers, userId, weekStart, [[2, 'lunch'], [2, 'dinner']])
  const lunch = menu.days[2].lunch.dishes.find((d: { kind: string }) => d.kind === 'recipe').recipeName as string

  // 1 · The dish's own link (the hero title).
  await nextWeekWednesday(page)
  await page.getByRole('link', { name: new RegExp(lunch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click()
  await expect(page).toHaveURL(/\/recipes\//, { timeout: 15_000 })
  await page.getByRole('link', { name: 'Volver' }).first().click()
  await expectBackOnWednesday(page, weekStart)

  // 2 · «Ver receta» in the meal's «···» sheet.
  await page.getByRole('button', { name: /^Más opciones de comida/ }).first().click()
  await page.getByRole('link', { name: 'Ver receta' }).click()
  await expect(page).toHaveURL(/\/recipes\//, { timeout: 15_000 })
  await page.goBack()
  await expectBackOnWednesday(page, weekStart)
})

// On desktop the recipe's back pill said «Recetas» and went to the catalogue.
test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('a recipe opened from the menu says «Menú» and goes back to that week and day', async ({ page }) => {
    test.setTimeout(150_000)
    await registerFreshUser(page)
    await completeOnboarding(page)
    const { headers, userId } = await session(page)
    const weekStart = madridMondayIn(1)
    const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
    expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
    await menuWithRecipesOn(page, headers, userId, weekStart, [[2, 'lunch'], [2, 'dinner']])

    await page.goto('/menu')
    await page.getByRole('main').getByRole('button', { name: 'Semana siguiente' }).first().click()
    await expect(page.getByRole('button', { name: /próxima semana · volver a hoy/i })).toBeVisible({ timeout: 20_000 })
    await page
      .locator('[data-day-column="2"]')
      .getByRole('button', { name: /ver el miércoles/i })
      .first()
      .click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/miércoles/i)
    await page.getByTestId('menu-hero').locator('a[href*="desde=menu"]').first().click()
    await expect(page).toHaveURL(/\/recipes\/.*desde=menu/, { timeout: 15_000 })

    // The photo's pill (the sidebar has its own «Menú», which opens this week).
    const back = page.getByTestId('recipe-back')
    await expect(back).toHaveText('Menú', { timeout: 15_000 })
    await expect(back).toBeVisible({ timeout: 15_000 })
    await back.click()
    await expect(page).toHaveURL(new RegExp(`/menu\\?.*week=${weekStart}`), { timeout: 15_000 })
    await expect(page.getByRole('button', { name: /próxima semana · volver a hoy/i })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/miércoles/i)
  })
})
