/**
 * PRO-1091 — «Pregunta por WhatsApp» en el admin (specs/whatsapp.md): la
 * pregunta, el grupo (fechas de alta y días sin actividad), el recuento antes
 * de enviar y un botón. Con la API de verdad (sin WhatsApp ni plantilla en
 * e2e) el botón no deja enviar; con la respuesta fijada, se envía tras
 * confirmar y un recuento que ha cambiado no envía nada.
 */

import { test, expect, type Page } from '@playwright/test'
import { E2E_ADMIN } from './global-setup'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'
const QUESTION = '¿Qué es lo que más os cuesta de planificar la semana?'

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

const PREVIEW = {
  count: 3,
  excluded: { ya_enviada: 0, baja: 2, interna: 1, prueba: 5, sin_whatsapp: 4 },
  template: 'mimoia_pregunta_unica',
  configured: true,
}

test('con la API de verdad: cuenta los hogares y, sin plantilla, no deja enviar', async ({ page }) => {
  await loginAsAdmin(page)
  await page.goto('/admin/pregunta-whatsapp')
  await expect(page.getByRole('heading', { level: 1, name: 'Pregunta por WhatsApp' })).toBeVisible({ timeout: 15_000 })

  await page.getByLabel(/Pregunta \(va dentro/).fill(QUESTION)
  await page.getByRole('button', { name: 'Contar hogares' }).click()
  const preview = page.getByTestId('whatsapp-question-preview')
  await expect(preview).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('whatsapp-question-count')).toHaveText(/^\d+$/)
  await expect(preview.getByText(/Falta la plantilla «pregunta_unica»/)).toBeVisible()
  await expect(preview.getByRole('button', { name: /^Enviar a/ })).toBeDisabled()
})

test('el recuento, las exclusiones y el envío tras confirmar', async ({ page }) => {
  await loginAsAdmin(page)
  let sendBody: Record<string, unknown> | null = null
  await page.route(/\/admin\/whatsapp-question\/preview$/, (route) => route.fulfill({ json: PREVIEW }))
  await page.route(/\/admin\/whatsapp-question\/send$/, (route) => {
    sendBody = route.request().postDataJSON()
    return route.fulfill({ json: { sent: 3, failed: 0, skipped: 0, remaining: 0 } })
  })
  await page.goto('/admin/pregunta-whatsapp')

  await page.getByLabel(/Pregunta \(va dentro/).fill(QUESTION)
  await page.getByLabel('Días sin actividad (0 = da igual)').fill('14')
  await page.getByRole('button', { name: 'Contar hogares' }).click()

  await expect(page.getByTestId('whatsapp-question-count')).toHaveText('3')
  await expect(page.getByTestId('whatsapp-question-excluded')).toHaveText(
    'Fuera: 2 pidieron BAJA · 1 cuenta interna · 5 hogares de prueba · 4 sin WhatsApp',
  )
  await expect(page.getByText('mimoia_pregunta_unica')).toBeVisible()

  page.once('dialog', (d) => {
    expect(d.message()).toContain('¿Enviar la pregunta a 3 hogares por WhatsApp?')
    void d.accept()
  })
  await page.getByRole('button', { name: 'Enviar a 3 hogares' }).click()
  await expect(page.getByTestId('whatsapp-question-result')).toContainText('Enviada a 3 hogares.')
  expect(sendBody).toMatchObject({ text: QUESTION, inactiveDays: 14, expectedCount: 3 })
})

test('si el recuento ha cambiado, no se envía y lo dice', async ({ page }) => {
  await loginAsAdmin(page)
  await page.route(/\/admin\/whatsapp-question\/preview$/, (route) => route.fulfill({ json: PREVIEW }))
  await page.route(/\/admin\/whatsapp-question\/send$/, (route) =>
    route.fulfill({ status: 409, json: { error: 'El recuento ha cambiado: ahora son 4. Revísalo y vuelve a enviar.', reason: 'count_changed', count: 4 } }),
  )
  await page.goto('/admin/pregunta-whatsapp')
  await page.getByLabel(/Pregunta \(va dentro/).fill(QUESTION)
  await page.getByRole('button', { name: 'Contar hogares' }).click()
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Enviar a 3 hogares' }).click()
  await expect(page.getByText('El recuento ha cambiado: ahora son 4.', { exact: false })).toBeVisible()
  await expect(page.getByTestId('whatsapp-question-result')).toHaveCount(0)
})

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('«Pregunta por WhatsApp» está en el menú del admin', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin')
    const adminNav = page.getByRole('navigation', { name: 'Admin', exact: true })
    await expect(adminNav).toBeVisible({ timeout: 15_000 })
    await adminNav.getByRole('link', { name: 'Pregunta por WhatsApp' }).click()
    await expect(page).toHaveURL(/\/admin\/pregunta-whatsapp$/)
    await expect(page.getByTestId('whatsapp-question-section')).toBeVisible()
  })
})
