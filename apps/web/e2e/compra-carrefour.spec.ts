/**
 * PRO-84 (specs/shop-orders.md): on the súper card of /compra, «Hacer este
 * pedido en Carrefour.es» opens one search link on carrefour.es per line —
 * no affiliate parameters — and the tap is counted (`carrefour_click`).
 */
import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test('súper card → Carrefour.es links per line, click counted', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const auth = { Authorization: `Bearer ${token}` }
  const shop = await page.request.post(`${API_URL}/shops`, {
    headers: auth,
    data: { name: 'Súper del barrio', kind: 'supermercado', channel: 'whatsapp', whatsapp: '34600000001', customerName: 'Miguel', fulfilment: 'recoger' },
  })
  expect(shop.ok()).toBe(true)
  // Deterministic list: two packaged products typed by hand go to the súper.
  const list = await (await page.request.get(`${API_URL}/shopping-list`, { headers: auth })).json()
  for (const name of ['leche entera', 'galletas']) {
    const r = await page.request.post(`${API_URL}/shopping-list/${list.id}/items`, { headers: auth, data: { name } })
    expect(r.ok()).toBe(true)
  }

  await page.goto('/compra')
  const later = page.getByRole('button', { name: 'No mostrar otra vez' })
  if (await later.isVisible({ timeout: 1_000 }).catch(() => false)) await later.click()
  await page.getByRole('button', { name: /Preparar los pedidos/ }).click()

  const card = page.getByTestId('order-supermercado')
  await expect(card).toBeVisible({ timeout: 15_000 })
  const button = card.getByRole('button', { name: 'Hacer este pedido en Carrefour.es' })
  await expect(button).toBeVisible()

  const click = page.waitForRequest((r) => r.url().includes('/carrefour-click') && r.method() === 'POST')
  const clickRes = page.waitForResponse((r) => r.url().includes('/carrefour-click'))
  await button.click()
  await click
  expect((await clickRes).status()).toBe(204)

  const links = card.getByTestId('carrefour').getByRole('link', { name: /en Carrefour\.es/ })
  await expect(links.first()).toBeVisible()
  const count = await links.count()
  expect(count).toBeGreaterThanOrEqual(2)
  const queries: string[] = []
  for (let i = 0; i < count; i++) {
    const u = new URL((await links.nth(i).getAttribute('href'))!)
    expect(u.hostname).toBe('www.carrefour.es')
    expect([...u.searchParams.keys()]).toEqual(['q']) // no affiliate / campaign parameters
    expect(await links.nth(i).getAttribute('rel')).toContain('noreferrer')
    queries.push(u.searchParams.get('q')!)
  }
  expect(queries.join(' | ')).toMatch(/leche/i)
  expect(queries.join(' | ')).toMatch(/galletas/i)
})
