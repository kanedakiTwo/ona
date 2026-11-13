/**
 * PRO-1197 — «Pregunta por correo» en el admin (specs/admin-dashboard.md):
 * el recuento exacto de hogares que lo dejaron, por qué quedan fuera los
 * demás, el correo tal cual sale y un botón que pide confirmar. Con la API
 * de verdad (en e2e todos los hogares son de prueba o recientes) no hay a
 * quién enviar; con la respuesta fijada, se envía tras confirmar, el botón
 * queda apagado después y un recuento que ha cambiado no envía nada.
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

const EMAIL = {
  subject: '¿Qué te faltó en Mimoia?',
  from: 'Miguel de Mimoia',
  footer: 'Te escribo porque tienes cuenta en la beta de Mimoia.',
  minChars: 80,
  maxChars: 4000,
}
// A stand-in body (the real one is the approved text Miguel pastes).
const BODY = 'Hola{, Nombre}:\n\nUna línea de prueba para el cuerpo del correo, lo bastante larga para pasar el mínimo de caracteres.\n\nGracias,\nFirma de prueba'
const textarea = (page: Page) => page.getByLabel(/Texto del correo/)
const STATUS = {
  count: 3,
  excluded: { activo: 12, interna: 1, prueba: 5, suspendida: 0, baja: 2, ya_enviada: 0 },
  configured: true,
  inactiveDays: 14,
  sent: 0,
  failed: 0,
  lastSentAt: null,
  email: EMAIL,
}

test('con la API de verdad: el recuento, el correo aprobado y nadie a quien enviar', async ({ page }) => {
  await loginAsAdmin(page)
  await page.goto('/admin/pregunta-correo')
  await expect(page.getByRole('heading', { level: 1, name: 'Pregunta por correo' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('email-question-count')).toHaveText('0', { timeout: 15_000 })
  await expect(page.getByTestId('email-question-subject')).toHaveText('¿Qué te faltó en Mimoia?')
  await expect(page.getByTestId('email-question-preview')).toContainText('Te escribo porque tienes cuenta en la beta de Mimoia.')
  await textarea(page).fill(BODY)
  await expect(page.getByTestId('email-question-preview')).toContainText('Hola, Nombre:')
  await expect(page.getByRole('button', { name: /^Pregunta por correo a/ })).toBeDisabled()
})

test('el recuento, las exclusiones y el envío tras confirmar; después no se puede volver a enviar', async ({ page }) => {
  await loginAsAdmin(page)
  let sent = false
  let sendBody: Record<string, unknown> | null = null
  await page.route(/\/admin\/email-question$/, (route) =>
    route.fulfill({ json: sent ? { ...STATUS, count: 0, sent: 3, lastSentAt: '2026-11-13T09:00:00Z', excluded: { ...STATUS.excluded, ya_enviada: 3 } } : STATUS }),
  )
  await page.route(/\/admin\/email-question\/send$/, (route) => {
    sendBody = route.request().postDataJSON()
    sent = true
    return route.fulfill({ json: { sent: 3, failed: 0, skipped: 0 } })
  })
  await page.goto('/admin/pregunta-correo')

  await expect(page.getByTestId('email-question-count')).toHaveText('3', { timeout: 15_000 })
  await expect(page.getByTestId('email-question-excluded')).toHaveText(
    'Fuera: 12 hogares activos · 1 hogar con cuenta interna · 5 hogares de prueba · 2 hogares pidieron BAJA o «No, gracias»',
  )

  // Sin el texto del correo, no se puede enviar.
  await expect(page.getByRole('button', { name: 'Pregunta por correo a 3 hogares' })).toBeDisabled()
  await textarea(page).fill(BODY)
  // La vista previa: el saludo de cada persona y el texto, sin el saludo pegado.
  const preview = page.getByTestId('email-question-preview')
  await expect(preview).toContainText('Hola, Nombre:')
  await expect(preview).toContainText('Una línea de prueba para el cuerpo del correo')
  await expect(preview).not.toContainText('Hola{, Nombre}')

  // Cancelar en la confirmación no envía nada.
  page.once('dialog', (d) => void d.dismiss())
  await page.getByRole('button', { name: 'Pregunta por correo a 3 hogares' }).click()
  expect(sendBody).toBeNull()

  page.once('dialog', (d) => {
    expect(d.message()).toContain('¿Enviar «¿Qué te faltó en Mimoia?» a 3 hogares?')
    void d.accept()
  })
  await page.getByRole('button', { name: 'Pregunta por correo a 3 hogares' }).click()
  await expect(page.getByTestId('email-question-result')).toContainText('Enviado a 3 hogares.')
  expect(sendBody).toEqual({ body: BODY, expectedCount: 3 })

  // Recontado: ya no queda nadie y el botón se apaga.
  await expect(page.getByTestId('email-question-count')).toHaveText('0')
  await expect(page.getByTestId('email-question-sent')).toContainText('Ya enviado a 3 hogares')
  await expect(page.getByRole('button', { name: 'Pregunta por correo a 0 hogares' })).toBeDisabled()
})

test('si el recuento ha cambiado, no se envía y lo dice', async ({ page }) => {
  await loginAsAdmin(page)
  await page.route(/\/admin\/email-question$/, (route) => route.fulfill({ json: STATUS }))
  await page.route(/\/admin\/email-question\/send$/, (route) =>
    route.fulfill({ status: 409, json: { error: 'El recuento ha cambiado: ahora son 4. Revísalo antes de enviar.', reason: 'count_changed', count: 4 } }),
  )
  await page.goto('/admin/pregunta-correo')
  await textarea(page).fill(BODY, { timeout: 15_000 })
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: 'Pregunta por correo a 3 hogares' }).click({ timeout: 15_000 })
  await expect(page.getByText('El recuento ha cambiado: ahora son 4.', { exact: false })).toBeVisible()
  await expect(page.getByTestId('email-question-result')).toHaveCount(0)
})

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('«Pregunta por correo» está en el menú del admin', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin')
    const adminNav = page.getByRole('navigation', { name: 'Admin', exact: true })
    await expect(adminNav).toBeVisible({ timeout: 15_000 })
    await adminNav.getByRole('link', { name: 'Pregunta por correo' }).click()
    await expect(page).toHaveURL(/\/admin\/pregunta-correo$/)
    await expect(page.getByTestId('email-question-section')).toBeVisible()
  })
})
