/**
 * «Pedidos cerrados» on /compra unfold into what was asked for (PRO-288).
 * Miguel, 2026-10-20: after «Enviar a Mercadona» the closed order was a
 * single row («Mercadona · 20 oct · —») that didn't open. Now each one opens:
 * a WhatsApp order shows its lines in the shop's units and what was paid; a
 * súper order sent through the browser extension shows what went into the
 * cart (product and units) and the cart's total.
 *
 * Orders are built through the API from items the user typed, so the spec
 * never depends on the seed or on what the menu generator picks.
 */

import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

async function dismissOverlays(page: Page) {
  const later = page.getByRole('button', { name: 'No mostrar otra vez' })
  if (await later.isVisible({ timeout: 1_000 }).catch(() => false)) await later.click()
}

test('a closed order opens to show its lines, units and total', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const auth = { Authorization: `Bearer ${token}` }
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post(`${API_URL}${path}`, { headers: auth, data })
    expect(r.ok(), `${path} → ${r.status()} ${await r.text()}`).toBe(true)
    return r.json()
  }

  // Made-up shops only, never a real shop or person (PRO-76).
  await post('/shops', { name: 'Frutería del barrio', kind: 'fruteria', channel: 'whatsapp', whatsapp: '34600000001', customerName: 'Ana', fulfilment: 'recoger' })
  await post('/shops', { name: 'Súper del barrio', kind: 'supermercado', channel: 'web', webUrl: 'https://tienda.example/', customerName: 'Ana', fulfilment: 'recoger' })
  const list = await (await page.request.get(`${API_URL}/shopping-list`, { headers: auth })).json()
  for (const item of [
    { name: 'tomates', quantity: 1000, unit: 'g', aisle: 'produce' },
    { name: 'calabacín', quantity: 2, unit: 'u', aisle: 'produce' },
    { name: 'tomate triturado', quantity: 800, unit: 'g' },
  ]) {
    await post(`/shopping-list/${list.id}/items`, item)
  }

  const prepared = await post('/shop-orders/prepare', {})
  const fruta = (prepared.orders as any[]).find((o) => o.shop.kind === 'fruteria')
  const superOrder = (prepared.orders as any[]).find((o) => o.shop.kind === 'supermercado')
  expect(fruta).toBeTruthy()
  expect(superOrder).toBeTruthy()

  // Frutería: sent from WhatsApp, collected, 12,50 € paid.
  await post(`/shop-orders/${fruta.id}/sent`, {})
  await post(`/shop-orders/${fruta.id}/close`, { finalTotalEur: 12.5 })

  // Súper: what the browser extension reported, then closed with no amount.
  const tomate = (superOrder.lines as any[]).find((l) => l.name === 'tomate triturado')
  await post(`/shop-orders/${superOrder.id}/extension-result`, {
    envioId: 'e2e-cerrado-1',
    ok: true,
    lineas: [{ key: tomate.key, estado: 'tabla', productoId: '1', producto: 'Tomate triturado del súper 400 g', unidades: 2 }],
    anadidas: 1,
    totalEur: 1.9,
    bajoMinimo: false,
    version: 'e2e',
    contrato: 'e2e',
  })
  await post(`/shop-orders/${superOrder.id}/close`, {})

  await page.goto('/compra')
  await dismissOverlays(page)
  await page.getByText(/Pedidos cerrados · 2/).click({ timeout: 20_000 })

  const rows = page.getByTestId('closed-order')
  await expect(rows).toHaveCount(2)
  const frutaRow = rows.filter({ hasText: 'Frutería del barrio' })
  const superRow = rows.filter({ hasText: 'Súper del barrio' })
  await expect(frutaRow.locator('summary')).toContainText('12,5 €')
  await expect(superRow.locator('summary')).toContainText('1,9 €')

  // Closed until tapped.
  await expect(frutaRow.getByTestId('closed-order-lines')).toBeHidden()
  await frutaRow.locator('summary').click()
  const frutaLines = frutaRow.getByTestId('closed-order-lines')
  await expect(frutaLines).toBeVisible()
  // In the shop's units (buy rules), as the message said.
  await expect(frutaLines).toContainText('1 kg de tomates de ensalada')
  await expect(frutaLines).toContainText('2 calabacines')
  await expect(frutaRow.getByTestId('closed-order-total')).toContainText('Pagado')

  await superRow.locator('summary').click()
  const superLines = superRow.getByTestId('closed-order-lines')
  await expect(superLines).toBeVisible()
  await expect(superRow).toContainText('extensión del navegador')
  await expect(superLines).toContainText('Tomate triturado del súper 400 g')
  await expect(superLines).toContainText('× 2')
  await expect(superRow.getByTestId('closed-order-total')).toContainText('Total del carro')

  // Fits a 390 px phone: no horizontal scroll.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
