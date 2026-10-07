/**
 * "Compra en mis tiendas" (specs/shop-orders.md): add a shop through the
 * real form, prepare the orders from the shopping list, and check the
 * ready-to-send WhatsApp link — the whole point of the feature.
 *
 * Skips the order half gracefully if the catalog can't produce a menu with
 * fruit or vegetables (thin e2e seed).
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

  // A menu, so the list has fruit and vegetables to order.
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const d = new Date()
  d.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()))
  await page.request.post(`${API_URL}/menu/generate`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { userId, weekStart: d.toISOString().slice(0, 10) },
  })

  await page.goto('/compra')
  await dismissOverlays(page)
  await page.getByRole('button', { name: /Preparar los pedidos/ }).click()

  const card = page.getByTestId('order-fruteria')
  // isVisible() doesn't wait — waitFor does.
  const hasOrder = await card.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false)
  test.skip(!hasOrder, 'Seed menu has no fruit or vegetables for the next 7 days')

  await expect(card.getByText('The Fruits of the World')).toBeVisible()
  const link = card.getByRole('link', { name: /Enviar por WhatsApp/ })
  const href = await link.getAttribute('href')
  expect(href).toMatch(/^https:\/\/wa\.me\/34913525111\?text=/)
  const text = decodeURIComponent(href!.split('?text=')[1])
  expect(text).toMatch(/^Hola, soy Miguel\./)
  expect(text).toMatch(/\n- \S/)
  expect(text).toMatch(/precio por kilo/)
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
