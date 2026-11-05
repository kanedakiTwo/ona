/**
 * PRO-1123 — el editor de la newsletter en Admin (specs/newsletter.md →
 * «Editor en Admin»), a 390×844. Con la API de verdad: se guarda la
 * plantilla con sus huecos, se ve la vista previa y, sin correo en e2e, la
 * prueba no cuenta y no deja programar. Con las respuestas fijadas: desde la
 * recomendación de Marketing, la prueba a tu correo y «Programar» para el
 * viernes a las 9:00.
 */

import { test, expect, type Page } from '@playwright/test'
import { E2E_ADMIN } from './global-setup'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

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

const REST = {
  star: {
    title: 'Lentejas estofadas',
    body: 'De cuchara, para el primer fin de semana de frío.',
    imageUrl: 'https://mimoia.com/images/recipes/lentejas.jpg',
    imageAlt: 'Un plato de lentejas',
    url: 'https://mimoia.com/recipes/lentejas',
  },
  cta: { label: 'Abrir Mimoia', url: 'https://mimoia.com/menu' },
}

test('con la API de verdad: guarda la plantilla, enseña la vista previa y sin la prueba no programa', async ({ page }) => {
  await loginAsAdmin(page)
  const issue = `e2e-${Date.now()}`
  await page.goto('/admin/newsletter')
  await expect(page.getByRole('heading', { level: 1, name: 'Newsletter' })).toBeVisible({ timeout: 15_000 })
  const number = page.getByLabel('Número (la fecha del viernes)')
  await expect(number).toHaveValue(/^\d{4}-\d{2}-\d{2}$/)
  await number.fill(issue)
  await expect(page.getByText('Marketing aún no ha dejado su recomendación para este número.')).toBeVisible({ timeout: 15_000 })

  // `exact`: «Preheader (lo que se ve tras el asunto)» también dice «asunto».
  await page.getByLabel('Asunto', { exact: true }).fill('{nombre}, tu receta de esta semana')
  await page.getByLabel('Saludo', { exact: true }).fill('Hola, {nombre}:')
  await page.getByLabel('Carta', { exact: true }).fill('Esta semana te mando {receta}. {porque}')
  await page.getByLabel(/El resto del número/).fill(JSON.stringify(REST))
  await expect(page.getByTestId('newsletter-not-personal')).toHaveCount(0)
  await page.getByRole('button', { name: 'Guardar plantilla' }).click()
  await expect(page.getByTestId('newsletter-saved')).toContainText('Guardada el', { timeout: 15_000 })
  await expect(page.getByText('Falta que te mandes la prueba de lo guardado.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Programar para el viernes a las 9:00' })).toBeDisabled()

  await page.getByRole('button', { name: 'Ver vista previa' }).click()
  await expect(page.getByTestId('newsletter-previews')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Enviarme la prueba' }).click()
  // Sin Resend en e2e la prueba no sale y no cuenta; con él, llega a tu correo.
  await expect(page.getByTestId('newsletter-proof-sent').or(page.getByText(/La prueba no ha salido/))).toBeVisible({ timeout: 15_000 })
})

test('desde la recomendación, la prueba a tu correo y «Programar» para el viernes a las 9:00', async ({ page }) => {
  await loginAsAdmin(page)
  const recommendation = { subject: 'Tu receta de la semana', content: { ...REST, intro: 'Hola a todos, esta semana…' } }
  const draft: Record<string, unknown> = {
    issueId: '2026-11-06',
    recommendedAt: '2026-11-04T09:00:00.000Z',
    savedAt: null,
    proofSentAt: null,
    scheduledFor: null,
    sentAt: null,
    sendResult: null,
    ready: false,
    notReady: 'sin_plantilla',
    recommendation,
    template: null,
  }
  let saved: Record<string, any> | null = null
  await page.route(/\/admin\/newsletter\/drafts$/, (route) =>
    route.fulfill({ json: { drafts: [draft], nextFriday: '2026-11-06T08:00:00.000Z' } }),
  )
  await page.route(/\/admin\/newsletter\/drafts\/2026-11-06$/, (route) =>
    route.fulfill({ json: { draft, nextFriday: '2026-11-06T08:00:00.000Z' } }),
  )
  await page.route(/\/admin\/newsletter\/drafts\/2026-11-06\/template$/, (route) => {
    saved = route.request().postDataJSON()
    Object.assign(draft, { template: saved, savedAt: '2026-11-05T13:00:00.000Z', notReady: 'sin_prueba' })
    return route.fulfill({ json: { draft } })
  })
  await page.route(/\/admin\/newsletter\/drafts\/2026-11-06\/preview$/, (route) =>
    route.fulfill({
      json: {
        previews: [
          { to: 'a***@example.com', source: 'user', subject: 'Ana, tu receta', html: '<p>Hola, Ana:</p>' },
          { to: 'b***@example.com', source: 'user', subject: 'Tu receta', html: '<p>Hola:</p>' },
          { to: 'c***@example.com', source: 'waitlist', subject: 'Carla, tu receta', html: '<p>Hola, Carla:</p>' },
        ],
      },
    }),
  )
  await page.route(/\/admin\/newsletter\/drafts\/2026-11-06\/proof$/, (route) => {
    Object.assign(draft, { proofSentAt: '2026-11-05T13:01:00.000Z', ready: true, notReady: null })
    return route.fulfill({ json: { status: 'sent', to: 'm***@gmail.com', draft } })
  })
  await page.route(/\/admin\/newsletter\/drafts\/2026-11-06\/schedule$/, (route) => {
    Object.assign(draft, { scheduledFor: '2026-11-06T08:00:00.000Z' })
    return route.fulfill({ json: { draft } })
  })

  await page.goto('/admin/newsletter')
  const rec = page.getByTestId('newsletter-recommendation')
  await expect(rec.getByText('Tu receta de la semana')).toBeVisible({ timeout: 15_000 })
  await rec.getByRole('button', { name: 'Empezar desde la recomendación' }).click()
  await expect(page.getByLabel('Asunto', { exact: true })).toHaveValue('Tu receta de la semana')
  // Sin huecos saldría igual para todos: lo avisa; Miguel lo corrige.
  await expect(page.getByTestId('newsletter-not-personal')).toBeVisible()
  await page.getByLabel('Carta', { exact: true }).fill('{nombre}, esta semana te mando {receta}. {porque}')
  await expect(page.getByTestId('newsletter-not-personal')).toHaveCount(0)
  await page.getByRole('button', { name: 'Guardar plantilla' }).click()
  await expect(page.getByTestId('newsletter-saved')).toContainText('Guardada el')
  expect(saved).toMatchObject({ subject: 'Tu receta de la semana', content: { intro: '{nombre}, esta semana te mando {receta}. {porque}', star: { title: 'Lentejas estofadas' } } })

  await page.getByRole('button', { name: 'Ver vista previa' }).click()
  await expect(page.getByTestId('newsletter-preview')).toHaveCount(3)
  await expect(page.getByText('Ana, tu receta')).toBeVisible()

  await expect(page.getByRole('button', { name: 'Programar para el viernes a las 9:00' })).toBeDisabled()
  await page.getByRole('button', { name: 'Enviarme la prueba' }).click()
  await expect(page.getByTestId('newsletter-proof-sent')).toHaveText('Prueba enviada a m***@gmail.com, con tu propio caso.')
  await page.getByRole('button', { name: 'Programar para el viernes a las 9:00' }).click()
  await expect(page.getByTestId('newsletter-scheduled')).toContainText('viernes, 6 de noviembre')
  await expect(page.getByTestId('newsletter-scheduled')).toContainText('9:00')
})
