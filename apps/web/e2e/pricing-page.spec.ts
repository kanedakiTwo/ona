/**
 * /precios (specs/billing.md): two plans, Esencial first and recommended, a
 * monthly / yearly switch on both, and a table of everything each plan
 * includes. Logged out, the call to action is the waitlist. Mobile.
 */

import { test, expect } from '@playwright/test'

test('pricing page: Esencial recommended, monthly/yearly, what each plan includes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/precios')

  await expect(page.getByRole('heading', { level: 1 })).toContainText('todo tu hogar')
  // D-055/D-057: launch 15 December; the beta, like everyone, then has 14 days → first charge 29 December.
  await expect(page.getByText(/Abrimos el 15 de diciembre, con 14 días gratis/)).toBeVisible()
  await expect(page.getByText(/no\s+se cobra nada hasta el 29 de diciembre/)).toBeVisible()
  const esencial = page.getByTestId('pricing-esencial')
  const plus = page.getByTestId('pricing-plus')
  await expect(esencial).toContainText('Recomendado')
  await expect(plus).not.toContainText('Recomendado')
  await expect(page.getByTestId('pricing-price-esencial')).toHaveText('4,99 €/mes')
  await expect(page.getByTestId('pricing-price-plus')).toHaveText('8,99 €/mes')

  await page.getByTestId('period-anual').click()
  await expect(page.getByTestId('pricing-price-esencial')).toHaveText('49,99 €/año')
  await expect(page.getByTestId('pricing-price-plus')).toHaveText('59,99 €/año')
  await expect(esencial).toContainText('Sale a 4,17 €/mes')

  // Logged out → the waitlist.
  await expect(page.getByTestId('cta-esencial')).toHaveAttribute('href', '/#lista-de-espera')

  // Everything each plan includes: voice and Mimo writing to you are Plus only.
  const table = page.getByTestId('pricing-comparison')
  await expect(table).toBeVisible()
  const voice = table.getByRole('row', { name: /Hablar con Mimo por voz/ })
  await expect(voice.getByLabel('No incluido en Esencial')).toBeVisible()
  await expect(voice.getByLabel('Incluido en Plus')).toBeVisible()
  const whatsappChat = table.getByRole('row', { name: /Chat con Mimo por WhatsApp/ })
  await expect(whatsappChat).toContainText('Con tope mensual')

  // No horizontal scroll on a phone.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
