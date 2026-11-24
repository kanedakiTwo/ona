/**
 * «Que Mimoia se pague sola» (PRO-389, D-160; specs/billing.md), against the
 * real API, mobile: the card shows in Perfil → Suscripción, a tap records
 * `offer_interest` and closes it, and it doesn't come back there nor in
 * /precios. Never on /menu.
 */

import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

test('Suscripción: «Que Mimoia se pague sola» once per household', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  await page.goto('/menu')
  await expect(page.getByRole('heading', { name: 'Que Mimoia se pague sola' })).toHaveCount(0)

  await page.goto('/profile/suscripcion')
  const card = page.getByTestId('offer-interest')
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card).toContainText('Estamos preparando dos formas de que tus compras paguen la suscripción. ¿Cuál usarías?')
  await expect(card.getByRole('button')).toHaveText([
    'Un 5 % de descuento en mis tiendas del barrio al pedir con Mimoia',
    'Mimoia gratis el mes que compre más de 100 € en Carrefour con Mimoia',
    'Ninguna de las dos',
  ])

  const recorded = page.waitForResponse((r) => r.url().endsWith('/usage/offer-interest') && r.request().method() === 'POST')
  // A tap that lands while the page is still hydrating can be lost: tap again until it is answered.
  await expect(async () => {
    if (await card.isVisible()) await page.getByTestId('offer-interest-carrefour').click({ timeout: 2_000 }).catch(() => {})
    await expect(page.getByTestId('offer-interest-thanks')).toHaveText('Gracias, te avisamos en cuanto esté.', { timeout: 3_000 })
  }).toPass({ timeout: 20_000 })
  const res = await recorded
  expect(res.request().postDataJSON()).toEqual({ option: 'carrefour', where: 'suscripcion' })
  expect(await res.json()).toEqual({ counted: true })
  await expect(card).toHaveCount(0)

  await page.reload()
  await expect(page.getByText(/tienes Plus gratis hasta el/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('offer-interest')).toHaveCount(0)
  await expect(page.getByTestId('offer-interest-thanks')).toHaveCount(0)

  await page.goto('/precios')
  await expect(page.getByTestId('cta-esencial')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('offer-interest')).toHaveCount(0)
})
