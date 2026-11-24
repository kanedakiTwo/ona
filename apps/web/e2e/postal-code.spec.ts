/**
 * PRO-1124 (D-179): the household's postal code, on a phone (390×844).
 *   - «Preparar los pedidos» asks it once, with Legal's words (LEG-506) and
 *     «Ahora no» as visible as «Guardar»; skipped, it doesn't come back;
 *   - saved from the question, it shows in Perfil → Tu casa, where it's
 *     changed and deleted.
 */

import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

async function dismissOverlays(page: Page) {
  const later = page.getByRole('button', { name: 'No mostrar otra vez' })
  if (await later.isVisible({ timeout: 1_000 }).catch(() => false)) await later.click()
}

/** A fresh household with one made-up shop (PRO-76: never a real one), on /compra. */
async function householdWithShop(page: Page) {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const r = await page.request.post(`${API_URL}/shops`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Frutería del barrio', kind: 'fruteria', channel: 'whatsapp', whatsapp: '34600000021', fulfilment: 'recoger' },
  })
  expect(r.ok()).toBe(true)
  await page.goto('/compra')
  await dismissOverlays(page)
}

const prepareButton = (page: Page) => page.getByRole('button', { name: /Preparar los pedidos|Rehacer los pedidos/ })

test('asked once; «Ahora no» as visible as «Guardar», and it does not come back', async ({ page }) => {
  test.setTimeout(90_000)
  await householdWithShop(page)

  await prepareButton(page).click()
  const q = page.getByTestId('postal-code-question')
  await expect(q).toBeVisible({ timeout: 20_000 })
  await expect(q).toContainText('¿Cuál es tu código postal?')
  await expect(q).toContainText('Lo usamos para buscarte tiendas de barrio cerca. Puedes saltarlo.')

  const skip = q.getByRole('button', { name: 'Ahora no' })
  const save = q.getByRole('button', { name: 'Guardar' })
  await expect(skip).toBeVisible()
  await expect(save).toBeVisible()
  // Same class, same size: neither is the «main» one.
  expect(await skip.getAttribute('class')).toBe(await save.getAttribute('class'))
  const [a, b] = [await skip.boundingBox(), await save.boundingBox()]
  expect(Math.abs(a!.width - b!.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(a!.height - b!.height)).toBeLessThanOrEqual(1)
  // Fits the phone: nothing sticks out sideways.
  expect(b!.x + b!.width).toBeLessThanOrEqual(390)

  await skip.click()
  await expect(q).toHaveCount(0)

  await page.reload()
  await dismissOverlays(page)
  const again = page.waitForResponse((r) => r.url().endsWith('/shop-orders/prepare') && r.request().method() === 'POST')
  await prepareButton(page).click()
  expect((await (await again).json()).askPostalCode).toBe(false)
  await expect(prepareButton(page)).toBeEnabled({ timeout: 20_000 })
  await expect(page.getByTestId('postal-code-question')).toHaveCount(0)
})

test('saved from the question; changed and deleted in Perfil → Tu casa', async ({ page }) => {
  test.setTimeout(90_000)
  await householdWithShop(page)

  await prepareButton(page).click()
  const q = page.getByTestId('postal-code-question')
  await expect(q).toBeVisible({ timeout: 20_000 })
  await q.getByRole('textbox').fill('123')
  await q.getByRole('button', { name: 'Guardar' }).click()
  await expect(q.getByRole('alert')).toContainText('5 cifras')
  await q.getByRole('textbox').fill('28012')
  await q.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByTestId('postal-code-saved')).toContainText('28012')

  await page.goto('/profile/casa')
  await dismissOverlays(page)
  const section = page.getByTestId('postal-code-section')
  await expect(section.getByTestId('postal-code-current')).toHaveText('28012', { timeout: 20_000 })

  await section.getByRole('button', { name: 'Cambiar' }).click()
  await section.getByRole('textbox').fill('41001')
  await section.getByRole('button', { name: 'Guardar' }).click()
  await expect(section.getByTestId('postal-code-current')).toHaveText('41001')

  await page.reload()
  await expect(section.getByTestId('postal-code-current')).toHaveText('41001', { timeout: 20_000 })
  await section.getByRole('button', { name: 'Borrar' }).click()
  await expect(section.getByTestId('postal-code-current')).toHaveText('Sin poner')
})
