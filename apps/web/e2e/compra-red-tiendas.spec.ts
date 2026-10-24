/**
 * «Tiendas de Mimoia» (PRO-358, specs/shop-orders.md → «Tiendas de
 * Mimoia»), on a phone. Miguel adds two shops of the Red from /admin (here
 * through its API): a carnicería for one zone and a pescadería that ships to
 * all Spain. A household without a carnicería, from that zone, is asked its
 * postal code once, sees both, chooses the carnicería («No, es nueva») and
 * its meat order goes to it. A household from another zone sees only the
 * pescadería, chooses it saying «Sí, ya le compraba» and doesn't count.
 * Made-up shops and numbers only (PRO-76).
 */

import { test, expect, type Page } from '@playwright/test'
import { E2E_ADMIN } from './global-setup'
import { registerFreshUser, completeOnboarding, uniqueId } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

async function dismissOverlays(page: Page) {
  const later = page.getByRole('button', { name: 'No mostrar otra vez' })
  if (await later.isVisible({ timeout: 1_000 }).catch(() => false)) await later.click()
}

async function tokenOf(page: Page) {
  return { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('ona_token'))}` }
}

/** A valid postal code of province 40–49, different on every run. */
function randomPostalCode(): string {
  return `4${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`
}

test('a household of the zone chooses a carnicería of the Red; one from elsewhere only sees the ones that ship to all Spain', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const admin = process.env.E2E_ADMIN_TOKEN
  test.skip(!admin, 'needs ADMIN_EMAILS on the API (see global-setup.ts)')
  const adminAuth = { Authorization: `Bearer ${admin}` }

  const id = uniqueId().replace(/[^a-z0-9]/gi, '').slice(-6)
  const zone = randomPostalCode()
  let elsewhere = randomPostalCode()
  while (elsewhere === zone) elsewhere = randomPostalCode()
  const butcher = `Carnicería Prueba ${id}`
  const fishmonger = `Pescadería Envío ${id}`

  const created: Record<string, string> = {}
  for (const shop of [
    { name: butcher, kind: 'carniceria', tier: 'medio', coverage: { nationwide: false, areas: [{ label: 'Pueblo de prueba', postalCodes: [zone] }] }, channel: 'whatsapp', whatsapp: '34600000071', fulfilment: ['recogida', 'reparto'], deliveryMinEur: 20, deliveryFeeEur: 3, freeDeliveryFromEur: 50, notes: 'De martes a sábado, de 9:00 a 14:00' },
    { name: fishmonger, kind: 'pescaderia', tier: 'alto', coverage: { nationwide: true, areas: [] }, channel: 'whatsapp', whatsapp: '34600000072', fulfilment: ['envio'], deliveryFeeEur: 9 },
  ]) {
    const r = await page.request.post(`${API_URL}/admin/shop-network`, { headers: adminAuth, data: shop })
    expect(r.status(), await r.text()).toBe(201)
    created[shop.name] = (await r.json()).id
  }

  // ── Household of the zone, without a carnicería ──
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  await page.goto('/compra/tiendas')
  await dismissOverlays(page)
  const network = page.getByTestId('shop-network')
  await expect(network.getByRole('heading', { name: 'Tiendas de Mimoia' })).toBeVisible({ timeout: 20_000 })
  await expect(network.getByText('ninguna paga por salir antes')).toBeVisible()
  await expect(network.getByText('Cómo funciona')).toBeVisible()

  // Asked once; the zone's carnicería isn't there before.
  await expect(network.getByText('¿En qué código postal vivís?')).toBeVisible()
  await expect(network.getByText(butcher)).toHaveCount(0)
  await network.getByLabel('¿En qué código postal vivís?').fill(zone)
  await network.getByRole('button', { name: 'Guardar' }).click()
  await expect(network.getByText(`Para el ${zone}`)).toBeVisible({ timeout: 10_000 })
  await expect(network.getByText('¿En qué código postal vivís?')).toHaveCount(0)

  const card = network.getByTestId('network-shop').filter({ hasText: butcher })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Pedido mínimo 20 €')
  await expect(card).toContainText('gratis desde 50 €')
  await expect(network.getByTestId('network-shop').filter({ hasText: fishmonger })).toBeVisible()

  await card.getByRole('button', { name: `Elegir ${butcher}` }).click()
  await expect(card.getByText('¿Ya le comprabas?')).toBeVisible()
  await card.getByRole('button', { name: 'No, es nueva' }).click()

  // It's now one of the household's shops, and gone from the Red's list.
  const mine = page.locator('section li').filter({ hasText: butcher })
  await expect(mine).toBeVisible({ timeout: 10_000 })
  await expect(mine).toContainText('De Tiendas de Mimoia')
  await expect(network.getByText(butcher)).toHaveCount(0)

  // Its meat order goes to it.
  const auth = await tokenOf(page)
  const list = await (await page.request.get(`${API_URL}/shopping-list`, { headers: auth })).json()
  const added = await page.request.post(`${API_URL}/shopping-list/${list.id}/items`, { headers: auth, data: { name: 'pechuga de pollo', quantity: 500, unit: 'g' } })
  expect(added.ok()).toBe(true)
  const prepared = await (await page.request.post(`${API_URL}/shop-orders/prepare`, { headers: auth, data: {} })).json()
  const meat = prepared.orders.find((o: { shop: { name: string } }) => o.shop.name === butcher)
  expect(meat, JSON.stringify(prepared.orders.map((o: { shop: { name: string } }) => o.shop.name))).toBeTruthy()
  expect(meat.lines.map((l: { name: string }) => l.name).join(' ')).toMatch(/pollo/i)

  // ── Household from elsewhere ──
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  const other = await ctx.newPage()
  await registerFreshUser(other)
  if (other.url().includes('/onboarding')) await completeOnboarding(other)
  await other.goto('/compra/tiendas')
  await dismissOverlays(other)
  const net2 = other.getByTestId('shop-network')
  await net2.getByLabel('¿En qué código postal vivís?').fill(elsewhere)
  await net2.getByRole('button', { name: 'Guardar' }).click()
  await expect(net2.getByText(`Para el ${elsewhere}`)).toBeVisible({ timeout: 10_000 })
  const fish = net2.getByTestId('network-shop').filter({ hasText: fishmonger })
  await expect(fish).toBeVisible()
  await expect(net2.getByText(butcher)).toHaveCount(0)
  await fish.getByRole('button', { name: `Elegir ${fishmonger}` }).click()
  await fish.getByRole('button', { name: 'Sí, ya le compraba' }).click()
  await expect(other.locator('section li').filter({ hasText: fishmonger })).toBeVisible({ timeout: 10_000 })
  await ctx.close()

  // The count: the «no» counts, the «sí, ya le compraba» doesn't.
  const red = await (await page.request.get(`${API_URL}/admin/shop-network`, { headers: adminAuth })).json()
  expect(red.find((s: { id: string }) => s.id === created[butcher]).households).toBe(1)
  expect(red.find((s: { id: string }) => s.id === created[fishmonger]).households).toBe(0)

  // Don't leave this run's shops in the Red for the next households (baja keeps the households' copies).
  for (const shopId of Object.values(created)) {
    const r = await page.request.patch(`${API_URL}/admin/shop-network/${shopId}`, { headers: adminAuth, data: { status: 'baja' } })
    expect(r.ok()).toBe(true)
  }
})

test('Miguel gives a shop of the Red its alta from /admin/tiendas, then closes it to new households', async ({ page }) => {
  test.setTimeout(60_000)
  const login = await page.request.post(`${API_URL}/login`, { data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password } })
  expect(login.ok()).toBeTruthy()
  const { token, user } = await login.json()
  test.skip(user?.role !== 'admin', 'needs ADMIN_EMAILS on the API (see global-setup.ts)')
  await page.addInitScript(
    ([t, u]) => {
      localStorage.setItem('ona_token', t)
      localStorage.setItem('ona_user', u)
    },
    [token, JSON.stringify(user)] as const,
  )
  const name = `Frutería Alta ${uniqueId().replace(/[^a-z0-9]/gi, '').slice(-6)}`

  await page.goto('/admin/tiendas')
  await expect(page.getByRole('heading', { name: 'Tiendas de Mimoia' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Nueva tienda' }).click()
  const form = page.getByRole('form', { name: 'Nueva tienda de Mimoia' })
  await form.getByLabel('Nombre').fill(name)
  await form.getByLabel('Tipo').selectOption('fruteria')
  await form.getByLabel('Escalón').selectOption('bajo')
  await form.getByLabel('Cobertura (una zona por línea)').fill('Pueblo de prueba: 49990, 49991')
  await form.getByLabel('WhatsApp de la tienda').fill('600 000 073')
  await form.getByLabel('Pedido mínimo €').fill('15')
  await form.getByLabel('Gastos de envío €').fill('2,50')
  await form.getByRole('button', { name: 'Dar de alta' }).click()

  const row = page.getByTestId('admin-network-shop').filter({ hasText: name })
  await expect(row).toBeVisible({ timeout: 10_000 })
  await expect(row).toContainText('Frutería · € · Activa')
  await expect(row).toContainText('Pueblo de prueba')
  await expect(row.getByTestId('network-shop-households')).toHaveText('0')

  await row.getByRole('button', { name: 'No acepta hogares nuevos' }).click()
  await expect(row.getByRole('button', { name: 'Volver a activar' })).toBeVisible({ timeout: 10_000 })
  await expect(row).toContainText('Frutería · € · No acepta hogares nuevos')
  page.once('dialog', (d) => d.accept())
  await row.getByRole('button', { name: 'Dar de baja' }).click()
  await expect(row).toContainText('De baja', { timeout: 10_000 })
})
