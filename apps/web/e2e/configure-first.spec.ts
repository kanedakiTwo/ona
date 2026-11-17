/**
 * PRO-1180 · «Configurar pesa más que pedirle a la IA» (propuesta de Producto
 * 2026-11-11 §5, E-72).
 *
 * Hecho cuando (a 390×844 y a 1440×900):
 *   - la semana en blanco no tiene «Generar mi menú» ni el icono de
 *     destellos: sin semana tipo dice «Hacer mi menú» y «Primero, cuéntame
 *     cómo coméis»; con ella, su resumen, «Editar» y «Llenar con mi semana
 *     tipo», que genera la semana;
 *   - en «Añadir plato», «Que elija Mimoia» es la última opción;
 *   - «Cambiar algo» del piloto abre `/menu?week=` de esa semana.
 *
 * Las líneas y el orden, en apps/api/src/tests/blankWeekCopy.test.ts.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'
import { madridMondayIn } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'
const FRIDAY = 4

async function auth(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  return { Authorization: `Bearer ${token}` }
}

/** The blank week's card (the dashed one under the header). */
const blankCard = (page: Page) => page.locator('div.border-dashed').filter({ hasText: 'en blanco' })

async function blankWeekAndAddDish(page: Page) {
  await registerFreshUser(page)
  await completeOnboarding(page)
  const headers = await auth(page)
  const weekStart = madridMondayIn(1)

  // ── Sin semana tipo: «Hacer mi menú» y el enlace a contar cómo coméis.
  await page.goto(`/menu?week=${weekStart}`)
  const make = page.getByRole('button', { name: 'Hacer mi menú', exact: true })
  await expect(make).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('link', { name: 'Primero, cuéntame cómo coméis' })).toHaveAttribute('href', '/profile/semana-tipo')
  await expect(page.getByTestId('blank-week-type')).toHaveCount(0)
  await expect(page.getByText('Generar mi menú')).toHaveCount(0)
  await expect(blankCard(page).locator('svg.lucide-sparkles')).toHaveCount(0)

  // ── Con semana tipo (los viernes, pizza para cenar): su resumen y «Llenar con mi semana tipo».
  const put = await page.request.put(`${API}/households/me/week-type/${FRIDAY}/dinner`, {
    headers,
    data: { options: [{ kind: 'type', type: 'pizza' }] },
  })
  expect(put.ok(), `semana tipo: ${put.status()}`).toBeTruthy()
  await page.reload()
  const fill = page.getByRole('button', { name: 'Llenar con mi semana tipo', exact: true })
  await expect(fill).toBeVisible({ timeout: 20_000 })
  const summary = page.getByTestId('blank-week-type')
  await expect(summary).toContainText('Comida y cena')
  await expect(summary).toContainText('viernes cena: pizza')
  await expect(summary.getByRole('link', { name: 'Editar tu semana tipo' })).toHaveAttribute('href', '/profile/semana-tipo')
  await expect(page.getByRole('link', { name: 'Primero, cuéntame cómo coméis' })).toHaveCount(0)
  await expect(make).toHaveCount(0)
  await expect(page.getByText('Generar mi menú')).toHaveCount(0)
  await expect(blankCard(page).locator('svg.lucide-sparkles')).toHaveCount(0)

  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/menu/generate') && r.request().method() === 'POST', { timeout: 60_000 }),
    fill.click(),
  ])
  await expect(fill).toHaveCount(0, { timeout: 60_000 })

  // ── «Añadir plato»: elegir primero, «Que elija Mimoia» al final.
  await page.getByRole('button', { name: /^Más opciones de / }).first().click({ timeout: 20_000 })
  await page.getByTestId('meal-sheet-first').getByRole('button', { name: 'Añadir plato', exact: true }).click()
  const options = page.locator('[data-testid^="add-dish-"]')
  await expect(options).toHaveCount(3)
  await expect(options.nth(0)).toContainText('Elegir del catálogo')
  await expect(options.nth(1)).toContainText('Escribir un plato')
  await expect(options.nth(2)).toContainText('Que elija Mimoia')
  await expect(page.getByText('Mimoia sugiere')).toHaveCount(0)
}

/** The piloto's card, with a notice for next week (the API's is only there on Thursdays). */
async function autoplanChange(page: Page) {
  await registerFreshUser(page)
  await completeOnboarding(page)
  const weekStart = madridMondayIn(1)
  const end = new Date(`${weekStart}T12:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 6)
  const weekEnd = end.toISOString().slice(0, 10)
  await page.route('**/menu/autoplan', (route) => route.fulfill({ json: { notice: { weekStart, weekEnd } } }))
  await page.route('**/menu/autoplan/viewed', (route) => route.fulfill({ json: { ok: true } }))
  await page.goto('/menu')
  const card = page.getByTestId('autoplan-card')
  await expect(card).toBeVisible({ timeout: 20_000 })
  // Sin semana tipo no dice que la haya usado.
  await expect(card.getByTestId('autoplan-week-type')).toHaveCount(0)
  await card.getByTestId('autoplan-change').click()
  await expect(page).toHaveURL(new RegExp(`/menu\\?week=${weekStart}`))
  await expect(page.getByTestId('menu-week-range').first()).toBeVisible()
}

test.describe('móvil', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('semana en blanco con y sin semana tipo, y «Que elija Mimoia» al final de «Añadir plato»', async ({ page }) => {
    test.setTimeout(180_000)
    await blankWeekAndAddDish(page)
  })

  test('«Cambiar algo» del piloto abre esa semana', async ({ page }) => {
    test.setTimeout(90_000)
    await autoplanChange(page)
  })
})

test.describe('escritorio', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('semana en blanco con y sin semana tipo, y «Que elija Mimoia» al final de «Añadir plato»', async ({ page }) => {
    test.setTimeout(180_000)
    await blankWeekAndAddDish(page)
  })

  test('«Cambiar algo» del piloto abre esa semana', async ({ page }) => {
    test.setTimeout(90_000)
    await autoplanChange(page)
  })
})
