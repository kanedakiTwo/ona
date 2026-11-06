/**
 * PRO-1025 — «Uso de funciones» en el admin (specs/feature-usage.md): la
 * pantalla /admin/funciones pinta una fila por función desde
 * GET /admin/feature-usage, filtra por tipo y por hogar o persona, y enseña
 * los «Trucos de la newsletter». La respuesta de la API se fija aquí (la
 * tabla la rellena la pasada de la noche), con un grupo de «menos de 5».
 * Una vez sin fijar, para ver que la ruta de verdad contesta a un admin.
 */

import { test, expect, type Page } from '@playwright/test'
import { E2E_ADMIN } from './global-setup'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

async function loginAsAdmin(page: Page) {
  const r = await page.request.post(`${API_URL}/login`, {
    data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password },
  })
  expect(r.ok()).toBeTruthy()
  const { token, user } = await r.json()
  test.skip(user?.role !== 'admin', 'needs ADMIN_EMAILS on the API (see global-setup.ts)')
  await page.addInitScript(
    ([t, u]) => {
      localStorage.setItem('ona_token', t)
      localStorage.setItem('ona_user', u)
    },
    [token, JSON.stringify(user)] as const,
  )
}

const row = (over: Record<string, unknown>) => ({
  kind: 'accion',
  per: 'hogar',
  unit: 'hogares',
  users: 0,
  active: 0,
  lapsed: 0,
  never: 42,
  households: 0,
  uses30d: 0,
  usesTotal: 0,
  medianDaysSinceLast: null,
  share: 0,
  ...over,
})

const REPORT = {
  days: 30,
  from: '2026-09-29',
  includeInternal: false,
  countedUntil: '2026-10-28T23:00:00.000Z',
  base: { households: 42, people: 60 },
  features: [
    row({ id: 'menu_semanal', nombre: 'Menú de la semana', users: 40, active: 30, lapsed: 10, never: 'menos de 5', households: 40, uses30d: 120, usesTotal: 900, medianDaysSinceLast: 3, share: 0.952 }),
    row({ id: 'receta_foto', nombre: 'Guardar una receta desde una foto', users: 'menos de 5', active: 'menos de 5', lapsed: 'menos de 5', never: 39, households: 'menos de 5', uses30d: 'menos de 5', usesTotal: 'menos de 5', medianDaysSinceLast: 'menos de 5', share: null }),
    row({ id: 'mimo_chat', nombre: 'Hablar con Mimo en la app', per: 'persona', unit: 'personas', users: 12, active: 8, lapsed: 4, never: 48, households: 9, uses30d: 60, usesTotal: 300, medianDaysSinceLast: 1, share: 0.2 }),
    row({ id: 'app_instalada', nombre: 'La app instalada', kind: 'ajuste', users: 20, active: 18, lapsed: 'menos de 5', never: 22, households: 20, uses30d: 50, usesTotal: 80, medianDaysSinceLast: 2, share: 0.476 }),
  ],
  tricks: [
    { id: 'mimo_chat', nombre: 'Hablar con Mimo en la app', per: 'persona', unit: 'personas', never: 48, lapsed: 'menos de 5' },
    { id: 'receta_foto', nombre: 'Guardar una receta desde una foto', per: 'hogar', unit: 'hogares', never: 39, lapsed: 'menos de 5' },
    { id: 'app_instalada', nombre: 'La app instalada', per: 'hogar', unit: 'hogares', never: 22, lapsed: 'menos de 5' },
  ],
  definitions: {},
}

test('/admin/funciones: filas, filtros, trucos y «menos de 5»', async ({ page }) => {
  await loginAsAdmin(page)
  await page.route(/\/admin\/feature-usage(\?|$)/, (route) => route.fulfill({ json: REPORT }))
  await page.goto('/admin/funciones')

  await expect(page.getByRole('heading', { level: 1, name: 'Uso de funciones' })).toBeVisible({ timeout: 15_000 })
  const rows = page.getByTestId('feature-usage-row')
  await expect(rows).toHaveCount(4)
  const foto = rows.filter({ hasText: 'Guardar una receta desde una foto' })
  await expect(foto.getByText('menos de 5').first()).toBeVisible()
  await expect(rows.filter({ hasText: 'Menú de la semana' }).getByText('900', { exact: true })).toBeVisible()
  await expect(page.getByText('42 hogares y 60 personas')).toBeVisible()

  // Filtros: solo ajustes; después, solo por persona.
  await page.getByRole('group', { name: 'Tipo' }).getByRole('button', { name: 'Ajustes' }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('La app instalada')
  await page.getByRole('group', { name: 'Tipo' }).getByRole('button', { name: 'Todas' }).click()
  await page.getByRole('group', { name: 'Por' }).getByRole('button', { name: 'Por persona' }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Hablar con Mimo en la app')
  await page.getByRole('group', { name: 'Por' }).getByRole('button', { name: 'Hogar y persona' }).click()

  // Ordenar por las más usadas: el menú, primero.
  await page.getByLabel('Ordenar').selectOption('mas')
  await expect(rows.first()).toContainText('Menú de la semana')

  // Trucos de la newsletter.
  const tricks = page.getByTestId('feature-trick')
  await expect(page.getByRole('heading', { name: 'Trucos de la newsletter' })).toBeVisible()
  await expect(tricks).toHaveCount(3)
  await expect(tricks.first()).toContainText('48 personas nunca')
  await expect(tricks.nth(1)).toContainText('menos de 5 la dejaron')
})

test('/admin/funciones con la API de verdad: una fila por función', async ({ page }) => {
  await loginAsAdmin(page)
  await page.goto('/admin/funciones')
  await expect(page.getByRole('heading', { level: 1, name: 'Uso de funciones' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('feature-usage-row').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('feature-usage-row').filter({ hasText: 'Menú de la semana' })).toHaveCount(1)
})

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('«Uso de funciones» está en el menú del admin', async ({ page }) => {
    await loginAsAdmin(page)
    await page.route(/\/admin\/feature-usage(\?|$)/, (route) => route.fulfill({ json: REPORT }))
    await page.goto('/admin')
    const adminNav = page.getByRole('navigation', { name: 'Admin', exact: true })
    await expect(adminNav).toBeVisible({ timeout: 15_000 })
    await adminNav.getByRole('link', { name: 'Uso de funciones' }).click()
    await expect(page).toHaveURL(/\/admin\/funciones$/)
    await expect(page.getByTestId('feature-usage-row')).toHaveCount(4)
  })
})
