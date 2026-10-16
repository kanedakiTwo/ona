/**
 * PRO-123: on a computer, the WhatsApp code comes with a QR of the same
 * `wa.me` link as the button (onboarding «Por WhatsApp» and Perfil →
 * WhatsApp); on a phone, no QR. /whatsapp/* is mocked (specs/whatsapp.md).
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { registerFreshUser } from './_helpers'

const WA = 'https://wa.me/15550001111?text=Vincular%20Mimoia%3A%204F7K2A'
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function mockWhatsApp(page: Page) {
  await page.route('**/whatsapp/status', (route) =>
    json(route, { available: true, linked: false, phone: null, notify: false, prefs: {}, chatLink: null, nudge: false }),
  )
  await page.route('**/whatsapp/link-code', (route) =>
    json(route, { code: '4F7K2A', expiresAt: new Date(Date.now() + 600_000).toISOString(), message: 'Vincular Mimoia: 4F7K2A', waLink: WA }, 201),
  )
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

for (const vp of [
  { width: 1440, height: 900, qr: true },
  { width: 390, height: 844, qr: false },
]) {
  test(`onboarding «Por WhatsApp» at ${vp.width}px: ${vp.qr ? 'QR with the button’s link' : 'no QR'}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await mockWhatsApp(page)
    await registerFreshUser(page)
    await page.goto('/onboarding')
    await page.getByRole('button', { name: /por whatsapp/i }).click()
    const button = page.getByRole('link', { name: /enviar desde whatsapp/i })
    await expect(button).toHaveAttribute('href', WA, { timeout: 15_000 })
    const qr = page.getByTestId('whatsapp-qr')
    if (vp.qr) {
      await expect(qr).toBeVisible()
      await expect(qr).toHaveAttribute('data-href', WA)
      await expect(qr.locator('svg')).toBeVisible()
    } else {
      await expect(qr).toBeHidden()
    }
  })
}
