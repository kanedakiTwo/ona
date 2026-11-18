/**
 * PRO-1190 (approval 2026-11-08, Legal): with open registration the landing
 * says «Empiezas gratis · Sin tarjeta · Te borras con un clic · Ver planes»,
 * and «Ver planes» lands on the prices of «Cómo funciona», with Plus at its
 * D-169 price and what Gratis leaves out. Mobile (Pixel 7, 412 wide).
 */
import { test, expect, type Page } from '@playwright/test'

async function openMode(page: Page) {
  await page.route(/\/public\/config$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ registration: 'open' }) }),
  )
}

test('open: «Ver planes» under the hero goes to the prices in «Cómo funciona», Plus 9,99 €', async ({ page }) => {
  await openMode(page)
  await page.goto('/')
  await expect(page.getByTestId('hero-cta')).toHaveText(/Crea tu cuenta gratis/)
  await expect(page.getByText('Empiezas gratis · Sin tarjeta · Te borras con un clic ·').first()).toBeVisible()
  await expect(page.getByText('Gratis durante la beta', { exact: false })).toHaveCount(0)

  const link = page.getByTestId('hero-plans-link')
  await expect(link).toHaveText('Ver planes')
  await link.click()

  await expect(page).toHaveURL(/\/como-funciona#precios$/)
  const prices = page.getByTestId('como-funciona-precios')
  await expect(prices).toBeInViewport()
  await expect(page.getByTestId('como-funciona-price-plus')).toHaveText('9,99 €/mes · 99,99 €/año')
  await expect(page.getByTestId('como-funciona-price-esencial')).toHaveText('4,99 €/mes · 49,99 €/año')
  await expect(page.getByTestId('como-funciona-gratis-leaves-out')).toContainText('sin piloto automático, sin avisos')
  await expect(page.getByTestId('como-funciona-gratis-leaves-out')).toContainText('Sin Mimo (chat y voz)')
})

test('the final CTA and «Recuerda lo que le vas contando» link to the same prices', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('final-plans-link')).toHaveAttribute('href', '/como-funciona#precios')
  await expect(page.getByTestId('differential-plans-link')).toHaveAttribute('href', '/como-funciona#precios')
  await expect(page.getByText('Te deja la semana hecha cada jueves')).toHaveCount(1)
})
