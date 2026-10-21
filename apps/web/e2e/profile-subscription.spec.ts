/**
 * Perfil → Suscripción (specs/billing.md), against the real API. CI runs
 * without Stripe keys, so payments are off: the hub shows the beta, and the
 * page says it'll be possible soon and links to /precios. Mobile.
 */

import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

test('profile → Suscripción: beta on Plus, payments not open yet', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  await page.goto('/profile')
  const link = page.getByRole('link', { name: /Suscripción/ })
  await expect(link).toContainText('Beta: Plus gratis', { timeout: 10_000 })
  // A tap that lands while the page is still hydrating can be lost (it failed
  // now and then on master, PRO-304): tap again until the route changes.
  await expect(async () => {
    if (!/\/profile\/suscripcion/.test(page.url())) await link.click({ timeout: 2_000 }).catch(() => {})
    await expect(page).toHaveURL(/\/profile\/suscripcion/, { timeout: 3_000 })
  }).toPass({ timeout: 20_000 })
  await expect(page.getByText(/tienes Plus gratis hasta el 15 de diciembre/)).toBeVisible()
  await expect(page.getByText(/Muy pronto podrás dejar tu plan pagado/)).toBeVisible()
  await expect(async () => {
    if (!/\/precios/.test(page.url())) await page.getByRole('link', { name: 'Precios' }).click({ timeout: 2_000 }).catch(() => {})
    await expect(page).toHaveURL(/\/precios/, { timeout: 3_000 })
  }).toPass({ timeout: 20_000 })
  // Logged in without payments: the button says it's coming.
  await expect(page.getByTestId('cta-esencial')).toHaveText('Muy pronto podrás pagarlo aquí')
})
