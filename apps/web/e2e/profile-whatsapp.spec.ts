/**
 * PRO-1040: the welcome email and Mimo say «conecta WhatsApp desde tu
 * perfil», so on the phone (390×844) Perfil has a «WhatsApp» row that leads
 * to the code; with the channel off there's no row (and nothing promises it).
 * The real link completes from a phone, so /whatsapp/* is mocked.
 */

import { test, expect, type Route } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.use({ viewport: { width: 390, height: 844 } })

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

test('Perfil → WhatsApp → «Conectar WhatsApp» gives the code', async ({ page }) => {
  await page.route('**/whatsapp/status', (route) =>
    json(route, { available: true, linked: false, phone: null, notify: false, chatLink: null }),
  )
  await page.route('**/whatsapp/link-code', (route) =>
    json(route, {
      code: '4F7K2A',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      message: 'Vincular Mimoia: 4F7K2A',
      waLink: 'https://wa.me/15550001111?text=Vincular%20Mimoia%3A%204F7K2A',
    }, 201),
  )

  await page.goto('/profile')
  const row = page.getByTestId('profile-whatsapp').getByRole('link', { name: /^WhatsApp/ })
  await expect(row).toBeVisible({ timeout: 20_000 })
  await expect(row).toContainText('Sin conectar')
  await row.click()

  await expect(page).toHaveURL(/\/profile\/ajustes#whatsapp$/)
  const connect = page.getByRole('button', { name: /conectar whatsapp/i })
  await expect(connect).toBeVisible({ timeout: 10_000 })
  await connect.click()
  await expect(page.getByTestId('whatsapp-link-message')).toHaveText('Vincular Mimoia: 4F7K2A')
  await expect(page.getByRole('link', { name: /abrir whatsapp/i })).toHaveAttribute('href', /wa\.me\/15550001111\?text=/)
})

test('with the channel off, Perfil has no WhatsApp row', async ({ page }) => {
  await page.route('**/whatsapp/status', (route) =>
    json(route, { available: false, linked: false, phone: null, notify: false, chatLink: null }),
  )
  await page.goto('/profile')
  await expect(page.getByTestId('profile-shopping')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('profile-whatsapp')).toHaveCount(0)
})
