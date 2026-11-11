/**
 * PRO-1174: medir cada opción de las hojas «···» del menú. Abrir la hoja de
 * una comida y tocar «Ver receta» manda `menu_sheet_action` con la hoja
 * (`comida`) y la opción (`ver_receta`), y la API lo cuenta. A 390×844 y a
 * 1440×900.
 */
import { test, expect, type Page, type Request } from '@playwright/test'
import { completeOnboarding, menuWithRecipesOn, registerFreshUser } from './_helpers'
import { madridMondayIn } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'

async function nextWeekWithLunch(page: Page) {
  await registerFreshUser(page)
  await completeOnboarding(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const headers = { Authorization: `Bearer ${token}` }
  const weekStart = madridMondayIn(1)
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  // Una comida de un solo plato el miércoles: su hoja es la de «comida».
  await menuWithRecipesOn(page, headers, userId, weekStart, [[2, 'lunch']])
}

/** Espera el POST /usage/event de una opción de hoja y devuelve lo que llevaba y lo que contestó la API. */
function sheetEvent(page: Page) {
  return page.waitForRequest(
    (r: Request) => r.method() === 'POST' && r.url().endsWith('/usage/event') && r.postDataJSON()?.name === 'menu_sheet_action',
    { timeout: 15_000 },
  )
}

async function expectCounted(req: Request) {
  expect(req.postDataJSON()).toEqual({ name: 'menu_sheet_action', props: { sheet: 'comida', action: 'ver_receta' } })
  const res = await req.response()
  expect(res?.status()).toBe(200)
  expect(await res?.json()).toEqual({ counted: true })
}

test.describe('móvil', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('«Ver receta» en la hoja de una comida manda menu_sheet_action comida · ver_receta', async ({ page }) => {
    test.setTimeout(150_000)
    await nextWeekWithLunch(page)
    await page.goto('/menu')
    await page.getByRole('main').getByRole('button', { name: 'Semana siguiente' }).click()
    await expect(page.getByRole('button', { name: /próxima semana · volver a hoy/i })).toBeVisible({ timeout: 20_000 })
    const strip = page.getByRole('navigation', { name: 'Días de la semana' })
    await strip.getByRole('button').nth(2).click()
    await expect(strip.getByRole('button').nth(2)).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: /^Más opciones de comida/ }).first().click()
    const sent = sheetEvent(page)
    await page.getByRole('link', { name: 'Ver receta' }).click()
    await expectCounted(await sent)
    await expect(page).toHaveURL(/\/recipes\//, { timeout: 15_000 })
  })
})

test.describe('escritorio', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('«Ver receta» en la hoja de una comida manda menu_sheet_action comida · ver_receta', async ({ page }) => {
    test.setTimeout(150_000)
    await nextWeekWithLunch(page)
    await page.goto('/menu')
    await page.getByRole('main').getByRole('button', { name: 'Semana siguiente' }).first().click()
    await expect(page.getByRole('button', { name: /próxima semana · volver a hoy/i })).toBeVisible({ timeout: 20_000 })
    await page.locator('[data-day-column="2"]').getByRole('button', { name: /ver el miércoles/i }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/miércoles/i)

    await page.getByRole('button', { name: /^Más opciones de comida/ }).first().click()
    const sent = sheetEvent(page)
    await page.getByRole('dialog').getByRole('link', { name: 'Ver receta' }).click()
    await expectCounted(await sent)
    await expect(page).toHaveURL(/\/recipes\//, { timeout: 15_000 })
  })
})
