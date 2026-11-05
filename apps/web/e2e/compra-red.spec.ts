/**
 * Red de tiendas v2, tramo 1a (specs/red-tiendas.md): a
 * household with no shops gives its postal code on /compra, gets the Red's
 * frutería on its own, sees the card with the discount and the max, and
 * orders. CI seeds the test shops in 28001 (scripts/redTestShops.ts) and
 * gives the Red to @red.test.local only.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

async function dismissOverlays(page: Page) {
  const later = page.getByRole('button', { name: 'No mostrar otra vez' })
  if (await later.isVisible({ timeout: 1_000 }).catch(() => false)) await later.click()
}

test('postal code → Red frutería → −5 % and max → Pedir', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page, { emailDomain: 'red.test.local' })
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const auth = { Authorization: `Bearer ${token}` }
  const list = await (await page.request.get(`${API_URL}/shopping-list`, { headers: auth })).json()
  const r = await page.request.post(`${API_URL}/shopping-list/${list.id}/items`, { headers: auth, data: { name: 'manzanas', quantity: 1000, unit: 'g', aisle: 'produce' } })
  expect(r.ok()).toBe(true)

  // Never type before the page settles (PageTransition mounts it twice).
  await page.goto('/compra')
  await dismissOverlays(page)
  await expect(page.getByTestId('red-intro')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Preparar los pedidos/ }).click()

  const ask = page.getByTestId('red-postal-code')
  await expect(ask).toBeVisible({ timeout: 15_000 })
  await ask.getByLabel(/código postal/).fill('28001')
  await ask.getByRole('button', { name: 'Guardar' }).click()

  await expect(page.getByTestId('red-assigned-fruteria')).toContainText('Frutería de prueba', { timeout: 15_000 })
  const card = page.getByTestId('order-fruteria')
  await expect(card).toBeVisible()
  await expect(card.getByTestId('red-discount')).toHaveText(/−5 % ya descontado/)
  await expect(card.getByTestId('red-totals')).toContainText('Previsto: ≈')
  await expect(card.getByRole('link', { name: /Enviar por WhatsApp/ })).toHaveCount(0)

  await card.getByRole('button', { name: /^Pedir · como mucho/ }).click()
  await expect(card.getByTestId('red-ordered')).toContainText('Te avisamos cuando lo acepte', { timeout: 10_000 })

  // The order's short link (what Mimo hands out) opens its card on /compra, never wa.me.
  const orders = await (await page.request.get(`${API_URL}/shop-orders`, { headers: auth })).json()
  const order = orders.find((o: { red: unknown; shop: { kind: string } }) => o.red && o.shop.kind === 'fruteria')
  expect(order).toBeTruthy()
  const short = new URL(order.links.shortOrder).pathname.split('/').filter(Boolean).pop()
  const hop = await page.request.get(`/c/${short}`, { maxRedirects: 0 })
  expect(hop.status()).toBe(302)
  expect(hop.headers()['location']).toBe(`/compra?pedido=${order.id}`)
})
