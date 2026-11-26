/**
 * /precios (specs/billing.md): three plans (PRO-385, D-158): Gratis, Esencial
 * (recommended) and Plus, a monthly / yearly switch on the paid ones, and a
 * table of everything each plan includes. Logged out, the call to action is
 * the waitlist. Mobile.
 */

import { test, expect } from '@playwright/test'

test('pricing page: Gratis, Esencial recommended and Plus, monthly/yearly, what each plan includes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/precios')

  // Three plans, in this order.
  const cards = page.locator('[data-testid="pricing-gratis"], [data-testid="pricing-esencial"], [data-testid="pricing-plus"]')
  await expect(cards).toHaveCount(3)
  expect(await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).toEqual(['pricing-gratis', 'pricing-esencial', 'pricing-plus'])
  const gratis = page.getByTestId('pricing-gratis')
  await expect(gratis).toContainText('Lo haces tú: tu menú de la semana y la lista, en la web.')
  await expect(gratis).toContainText('Sin Mimo (chat y voz), sin piloto automático, sin avisos, sin importar recetas ni pedidos a tiendas.')
  await expect(page.getByTestId('pricing-price-gratis')).toHaveText('0 €')
  await expect(gratis).not.toContainText('Recomendado')

  await expect(page.getByRole('heading', { level: 1 })).toContainText('todo tu hogar')
  // D-055/D-057: launch 15 December; the beta, like everyone, then has 14 days → first charge 29 December.
  await expect(page.getByText(/Abrimos el 15 de diciembre, con 14 días gratis/)).toBeVisible()
  await expect(page.getByText(/no\s+se cobra nada hasta el 29 de diciembre/)).toBeVisible()
  const esencial = page.getByTestId('pricing-esencial')
  const plus = page.getByTestId('pricing-plus')
  await expect(esencial).toContainText('Recomendado')
  await expect(plus).not.toContainText('Recomendado')
  await expect(page.getByTestId('pricing-price-esencial')).toHaveText('4,99 €/mes')
  await expect(page.getByTestId('pricing-price-plus')).toHaveText('9,99 €/mes')

  await page.getByTestId('period-anual').click()
  await expect(page.getByTestId('pricing-price-esencial')).toHaveText('49,99 €/año')
  await expect(page.getByTestId('pricing-price-plus')).toHaveText('99,99 €/año')
  await expect(esencial).toContainText('Sale a 4,17 €/mes')
  await expect(plus).toContainText('Sale a 8,33 €/mes')

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
  // Gratis: the week and the list, not Mimo.
  await expect(table.getByRole('columnheader', { name: 'Gratis' })).toBeVisible()
  await expect(whatsappChat.getByLabel('No incluido en Gratis')).toBeVisible()
  await expect(table.getByRole('row', { name: /Lista de la compra automática/ }).getByLabel('Incluido en Gratis')).toBeVisible()
  await expect(table.getByRole('row', { name: /Menú semanal a tu medida/ })).toContainText('En la web')

  // No horizontal scroll on a phone.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
