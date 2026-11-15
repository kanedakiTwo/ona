/**
 * PRO-1233 · Semana en blanco: «La semana» enseña la semana tipo.
 *
 * Hecho cuando (a 1440×900 y a 390×844): una semana vaciada enseña en el
 * sábado, comida, el tipo de la semana tipo («Legumbres») y «Añadir»; tras
 * «Llenar con mi semana tipo», ya no.
 *
 * La semana es la que viene: futura a cualquier hora.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'
import { madridMondayIn } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'
const SATURDAY = 5

/** A household whose semana tipo has legumbres on Saturday's lunch, and next week emptied. */
async function blankWeekWithLegumes(page: Page) {
  await registerFreshUser(page)
  await completeOnboarding(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const headers = { Authorization: `Bearer ${token}` }
  const slot = await page.request.put(`${API}/households/me/week-type/${SATURDAY}/lunch`, {
    headers,
    data: { options: [{ kind: 'type', type: 'legumbres' }] },
  })
  expect(slot.ok(), `semana tipo: ${slot.status()}`).toBeTruthy()
  const weekStart = madridMondayIn(1)
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, empty: true, force: true } })
  expect(gen.ok(), `vaciar: ${gen.status()}`).toBeTruthy()
  return weekStart
}

/** «Llenar con mi semana tipo»: the week fills and the hints go. */
async function fill(page: Page) {
  const generated = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/menu/generate'), { timeout: 90_000 })
  await page.getByRole('button', { name: 'Llenar con mi semana tipo' }).click()
  expect((await generated).ok()).toBeTruthy()
  await expect(page.getByTestId('week-type-skeleton')).toHaveCount(0, { timeout: 30_000 })
}

test.describe('escritorio', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('una semana vaciada enseña la semana tipo en sus huecos, y al llenarla ya no', async ({ page }) => {
    test.setTimeout(180_000)
    const weekStart = await blankWeekWithLegumes(page)
    await page.goto(`/menu?week=${weekStart}`)
    const cell = page.locator(`[data-week-cell="${SATURDAY}-lunch"]`)
    await expect(cell.getByTestId('week-type-hint')).toHaveText('Legumbres', { timeout: 20_000 })
    await expect(cell.getByRole('button', { name: /Comida del sábado: añadir un plato\. Tu semana tipo: Legumbres/ })).toContainText('Añadir')
    // A free slot says so; «Añadir» opens the same sheet as always.
    await expect(page.locator(`[data-week-cell="${SATURDAY}-dinner"]`).getByTestId('week-type-hint')).toHaveText('Cualquier receta')
    await cell.getByRole('button', { name: /Comida del sábado/ }).click()
    const sheet = page.getByRole('heading', { name: 'Añadir plato', level: 3 })
    await expect(sheet).toBeVisible()
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await fill(page)
    await expect(cell).toContainText('Legumbres · semana tipo', { timeout: 20_000 })
    await expect(page.getByTestId('week-type-hint')).toHaveCount(0)
  })
})

test.describe('móvil', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('una semana vaciada enseña la semana tipo en la vista día y en la vista semana, y al llenarla ya no', async ({ page }) => {
    test.setTimeout(180_000)
    const weekStart = await blankWeekWithLegumes(page)
    // Vista día, el sábado.
    await page.goto(`/menu?week=${weekStart}&day=${SATURDAY}`)
    const lunch = page.getByTestId('empty-meal').filter({ hasText: /comida/i })
    await expect(lunch.getByTestId('week-type-hint')).toHaveText('Legumbres', { timeout: 20_000 })
    await expect(lunch).toContainText('Añadir plato')
    // Vista semana.
    await page.evaluate(() => localStorage.setItem('ona.menu.view', 'week'))
    await page.goto(`/menu?week=${weekStart}`)
    const saturday = page.locator(`[data-day="${SATURDAY}"]`)
    const row = saturday.getByRole('button').filter({ hasText: 'Legumbres' })
    await expect(row).toBeVisible({ timeout: 20_000 })
    await expect(row).toContainText('+ Añadir')
    await expect(row).toContainText(/comida/i)
    await fill(page)
    await expect(saturday).toBeVisible({ timeout: 20_000 })
    // The lunch has its dish now (a small catalog may leave another meal empty: it says just «+ Añadir»).
    await expect(saturday.getByRole('button').filter({ hasText: /^Comida\s*\+ Añadir/ })).toHaveCount(0, { timeout: 20_000 })
    await expect(saturday).not.toContainText('Legumbres+ Añadir')
    await expect(page.getByText(/Tu semana está/)).toHaveCount(0)
    await expect(page.getByTestId('week-type-hint')).toHaveCount(0)
  })
})
