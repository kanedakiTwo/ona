/**
 * Ordering shops inside their kind on /compra/tiendas (PRO-287). Miguel
 * wanted Mercadona as his first súper, ahead of El Corte Inglés, and had to
 * delete El Corte Inglés: there was no way to reorder. The first shop of a
 * kind gets that kind's order, so «Subir» / «Bajar» only appear when there
 * are two of the same kind, and the new order survives a reload.
 */

import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

async function dismissOverlays(page: Page) {
  const later = page.getByRole('button', { name: 'No mostrar otra vez' })
  if (await later.isVisible({ timeout: 1_000 }).catch(() => false)) await later.click()
}

test('move the second súper first; the order is saved', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  // Made-up shops only, never a real shop or person (PRO-76).
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const auth = { Authorization: `Bearer ${token}` }
  for (const shop of [
    { name: 'Súper de la esquina', kind: 'supermercado', channel: 'whatsapp', whatsapp: '34600000010', fulfilment: 'recoger' },
    { name: 'Frutería del barrio', kind: 'fruteria', channel: 'whatsapp', whatsapp: '34600000011', fulfilment: 'recoger' },
    { name: 'Súper del centro', kind: 'supermercado', channel: 'whatsapp', whatsapp: '34600000012', fulfilment: 'recoger' },
  ]) {
    const r = await page.request.post(`${API_URL}/shops`, { headers: auth, data: shop })
    expect(r.ok()).toBe(true)
  }

  await page.goto('/compra/tiendas')
  await dismissOverlays(page)
  const names = page.locator('section li .font-display')
  await expect(names).toHaveText(['Súper de la esquina', 'Frutería del barrio', 'Súper del centro'], { timeout: 20_000 })

  // Only kinds with two shops get arrows; the first can't go up, the last can't go down.
  await expect(page.getByRole('button', { name: 'Subir Frutería del barrio' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Subir Súper de la esquina' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Bajar Súper del centro' })).toBeDisabled()
  await expect(page.getByText('la primera: recibe el pedido')).toHaveCount(1)

  await page.getByRole('button', { name: 'Subir Súper del centro' }).click()
  // The súper slots swap; the frutería keeps its place.
  await expect(names).toHaveText(['Súper del centro', 'Frutería del barrio', 'Súper de la esquina'])
  await expect(page.locator('section li', { hasText: 'Súper del centro' }).getByText('la primera: recibe el pedido')).toBeVisible()

  await page.reload()
  await expect(names).toHaveText(['Súper del centro', 'Frutería del barrio', 'Súper de la esquina'], { timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Subir Súper del centro' })).toBeDisabled()
})
