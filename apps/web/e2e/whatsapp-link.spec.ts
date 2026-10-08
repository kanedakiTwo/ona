/**
 * /profile → "Mimo en WhatsApp" card. The real link completes from a phone, so
 * the /whatsapp/* endpoints are mocked: we assert the card mints a code, shows
 * the wa.me link, flips to "conectado" once the status poll reports linked,
 * and wires the notify toggle + disconnect to the right requests.
 */

import { test, expect, type Route } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

test('link → linked → notify toggle → disconnect', async ({ page }) => {
  let status = { available: true, linked: false, phone: null as string | null, notify: false, chatLink: null as string | null }
  const requests: { method: string; url: string; body: unknown }[] = []

  await page.route('**/whatsapp/status', (route) => json(route, status))
  await page.route('**/whatsapp/link-code', (route) => {
    requests.push({ method: route.request().method(), url: route.request().url(), body: null })
    return json(route, {
      code: '4F7K2A',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      message: 'Vincular Mimoia: 4F7K2A',
      waLink: 'https://wa.me/15550001111?text=Vincular%20Mimoia%3A%204F7K2A',
    }, 201)
  })
  await page.route('**/whatsapp/link', (route) => {
    const req = route.request()
    requests.push({ method: req.method(), url: req.url(), body: req.postDataJSON?.() ?? null })
    if (req.method() === 'PATCH') {
      status = { ...status, notify: (req.postDataJSON() as { notify: boolean }).notify }
      return json(route, { notify: status.notify })
    }
    status = { available: true, linked: false, phone: null, notify: false, chatLink: null }
    return route.fulfill({ status: 204 })
  })

  await page.goto('/profile')
  await expect(page.getByText('WhatsApp', { exact: true })).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: /conectar whatsapp/i }).click()
  await expect(page.getByTestId('whatsapp-link-message')).toHaveText('Vincular Mimoia: 4F7K2A')
  await expect(page.getByRole('link', { name: /abrir whatsapp/i })).toHaveAttribute('href', /wa\.me\/15550001111\?text=/)
  expect(requests.some((r) => r.method === 'POST' && r.url.endsWith('/whatsapp/link-code'))).toBe(true)

  // The phone sends the code → the next status poll reports linked.
  status = { available: true, linked: true, phone: '+34 ••• ••• 222', notify: true, chatLink: 'https://wa.me/15550001111' }
  await expect(page.getByText('WhatsApp conectado')).toBeVisible({ timeout: 8_000 })
  await expect(page.getByTestId('whatsapp-phone')).toHaveText('+34 ••• ••• 222')
  await expect(page.getByRole('link', { name: /abrir chat con mimo/i })).toHaveAttribute('href', 'https://wa.me/15550001111')

  const toggle = page.locator('button[aria-pressed]').filter({ hasText: /avisos por whatsapp/i })
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({ notify: false })

  await page.getByRole('button', { name: /^desconectar$/i }).click()
  await page.getByRole('button', { name: /sí, desconectar/i }).click()
  await expect(page.getByRole('button', { name: /conectar whatsapp/i })).toBeVisible({ timeout: 5_000 })
  expect(requests.some((r) => r.method === 'DELETE')).toBe(true)
})

test('chapter stays hidden when the channel is not available', async ({ page }) => {
  await page.route('**/whatsapp/status', (route) =>
    json(route, { available: false, linked: false, phone: null, notify: false, chatLink: null }),
  )
  await page.goto('/profile')
  await expect(page.getByText('Memoria', { exact: false }).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: /conectar whatsapp/i })).toHaveCount(0)
})
