/**
 * "Compra en mis tiendas" (specs/shop-orders.md): add a shop through the
 * real form, prepare the orders from the shopping list, and check the
 * ready-to-send WhatsApp link — the whole point of the feature.
 *
 * The list is built from manual items, so it never depends on the seed or
 * on what the menu generator picks — the WhatsApp half always runs.
 */

import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

async function dismissOverlays(page: Page) {
  const later = page.getByRole('button', { name: 'No mostrar otra vez' })
  if (await later.isVisible({ timeout: 1_000 }).catch(() => false)) await later.click()
}

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('add a shop → prepare orders → WhatsApp link with the order written', async ({ page }) => {
  // Register + onboarding + the shop form + prepare: roomy on slow CI runners.
  test.setTimeout(60_000)
  await page.goto('/compra')
  await dismissOverlays(page)
  await expect(page.getByText(/Primero,/)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('link', { name: /Añadir tiendas/ }).click()
  await expect(page).toHaveURL(/\/compra\/tiendas/)

  await page.getByRole('button', { name: /Añadir tienda/ }).click()
  await page.getByLabel('Nombre', { exact: true }).fill('The Fruits of the World')
  await page.getByLabel('Tipo').selectOption('fruteria')
  await page.getByLabel('WhatsApp de la tienda').fill('913 52 51 11')
  await page.getByLabel('Tu nombre para la tienda').fill('Miguel')
  await page.getByRole('button', { name: /^Añadir tienda$/ }).click()
  await expect(page.getByText('WhatsApp +34913525111')).toBeVisible({ timeout: 10_000 })

  // Deterministic list, independent of the seed and the menu generator: two
  // items the user typed with aisle "produce" → they must land in the
  // frutería order (CI's thin seed puts every menu item in aisle "otros").
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const auth = { Authorization: `Bearer ${token}` }
  const list = await (await page.request.get(`${API_URL}/shopping-list`, { headers: auth })).json()
  for (const item of [
    { name: 'tomates', quantity: 1000, unit: 'g', aisle: 'produce' },
    { name: 'calabacín', quantity: 2, unit: 'u', aisle: 'produce' },
  ]) {
    const r = await page.request.post(`${API_URL}/shopping-list/${list.id}/items`, { headers: auth, data: item })
    expect(r.ok()).toBe(true)
  }

  await page.goto('/compra')
  await dismissOverlays(page)
  await page.getByRole('button', { name: /Preparar los pedidos/ }).click()

  const card = page.getByTestId('order-fruteria')
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card.getByText('The Fruits of the World')).toBeVisible()
  const link = card.getByRole('link', { name: /Enviar por WhatsApp/ })
  const href = await link.getAttribute('href')
  expect(href).toMatch(/^https:\/\/wa\.me\/34913525111\?text=/)
  const text = decodeURIComponent(href!.split('?text=')[1])
  expect(text).toMatch(/^Hola, soy Miguel\./)
  // Written in the shop's units (buy rules), never the recipe's.
  expect(text).toContain('- 1 kg de tomates de ensalada')
  expect(text).toContain('- 2 calabacines')
  expect(text).toContain('a partir de qué hora puedo pasar a recogerlo')
})

test('an expired or unknown short link lands on /compra with a notice (relative redirect)', async ({ page }) => {
  // The handler answers with a *relative* Location: behind Railway's proxy
  // req.url is http://0.0.0.0:3000, so an absolute redirect built from it
  // sent users to an unreachable host (prod, 2026-10-07).
  const r = await page.request.get('/c/zzzzzzzzzzzzzzzzzzzz', { maxRedirects: 0 })
  expect(r.status()).toBe(302)
  expect(r.headers()['location']).toBe('/compra?enlace=caducado')
  await page.goto('/c/zzzzzzzzzzzzzzzzzzzz')
  await expect(page).toHaveURL(/\/compra\?enlace=caducado/)
  await expect(page.getByText(/Ese enlace ya no vale/)).toBeVisible({ timeout: 10_000 })
})

test('a typed "Jamón serrano" blocks the order until the amount; home delivery carries address + ETA', async ({ page }) => {
  test.setTimeout(60_000)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const auth = { Authorization: `Bearer ${token}` }
  await page.request.post(`${API_URL}/shops`, {
    headers: auth,
    data: { name: 'Ben-Car', kind: 'carniceria', channel: 'whatsapp', whatsapp: '34638015827', customerName: 'Miguel', fulfilment: 'recoger' },
  })
  const list = await (await page.request.get(`${API_URL}/shopping-list`, { headers: auth })).json()
  await page.request.post(`${API_URL}/shopping-list/${list.id}/items`, { headers: auth, data: { name: 'Jamón serrano' } })

  await page.goto('/compra')
  await dismissOverlays(page)
  await page.getByRole('button', { name: /Preparar los pedidos/ }).click()
  const card = page.getByTestId('order-carniceria')
  await expect(card).toBeVisible({ timeout: 15_000 })
  // Never "1 unidad" of ham: the card asks how much and there's no send link yet.
  await expect(card.getByTestId('blockers')).toContainText('Jamón serrano: ¿cuánto?')
  await expect(card.getByRole('link', { name: /Enviar por WhatsApp/ })).toHaveCount(0)

  await card.getByRole('button', { name: '100 g' }).click()
  const link = card.getByRole('link', { name: /Enviar por WhatsApp/ })
  await expect(link).toBeVisible({ timeout: 10_000 })
  expect(decodeURIComponent((await link.getAttribute('href'))!)).toContain('- 100 g de jamón serrano, loncheado fino')

  // Home delivery: without an address it's blocked; with it, the message says where and asks when.
  await card.getByRole('button', { name: 'A domicilio' }).click()
  await expect(card.getByTestId('blockers')).toContainText('Falta la dirección de entrega')
  await card.getByLabel('Dirección de entrega').fill('C/ Real 1, Boadilla')
  await card.getByLabel('Dirección de entrega').blur()
  await expect(link).toBeVisible({ timeout: 10_000 })
  const text = decodeURIComponent((await card.getByRole('link', { name: /Enviar por WhatsApp/ }).getAttribute('href'))!)
  expect(text).toContain('para que me lo traigáis a C/ Real 1, Boadilla')
  expect(text).toContain('más o menos a qué hora llegaría')
})
