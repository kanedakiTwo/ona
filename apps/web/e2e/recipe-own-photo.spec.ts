/**
 * PRO-145 · «Subir mi foto» en «Nueva receta» (390×844): la receta se crea
 * con la foto del usuario, sin llamar al generador de fotos con IA, y la
 * ficha la enseña como foto principal. Después, en la galería, el autor
 * puede poner otra foto como principal.
 */

import path from 'node:path'
import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const PHOTO = path.join(__dirname, 'fixtures', 'plato-propio.jpg')

test.use({ viewport: { width: 390, height: 844 } })

test('crear una receta con foto propia: no se genera con IA y la ficha la enseña', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  const aiCalls: string[] = []
  const createUrls: string[] = []
  page.on('request', (req) => {
    if (req.url().includes('/regenerate-image')) aiCalls.push(req.url())
    if (req.method() === 'POST' && /\/recipes(\?|$)/.test(req.url())) createUrls.push(req.url())
  })

  await page.goto('/recipes/new')
  const name = `Ajo con foto propia ${Date.now()}`
  await page.locator('input[placeholder*="Tortilla" i]').fill(name)
  await page.getByRole('button', { name: /comida/i }).first().click()
  await page.getByRole('button', { name: /primavera/i }).first().click()

  const ingredientInput = page.getByPlaceholder(/ingrediente|cargando/i).first()
  await ingredientInput.fill('ajo')
  const ajoOption = page.locator('ul[role="listbox"] li button', { hasText: /^ajo$/i }).first()
  await ajoOption.waitFor({ state: 'visible', timeout: 10_000 })
  await ajoOption.click()
  await page.locator('input[placeholder="Cant."]').first().fill('10')
  await page.locator('textarea').first().fill('Pelar y picar el ajo')

  // Photo card: «Generar con IA» is the default; «Subir mi foto» picks a file.
  const card = page.getByTestId('new-recipe-photo')
  await card.scrollIntoViewIfNeeded()
  await expect(card.getByRole('button', { name: 'Generar con IA' })).toHaveAttribute('aria-pressed', 'true')
  const chooser = page.waitForEvent('filechooser')
  await card.getByRole('button', { name: 'Subir mi foto' }).click()
  await (await chooser).setFiles(PHOTO)
  await expect(card.getByTestId('new-recipe-photo-preview')).toBeVisible()
  await expect(card.getByRole('button', { name: 'Cambiar mi foto' })).toHaveAttribute('aria-pressed', 'true')
  await expect(card.getByRole('button', { name: 'Generar con IA' })).toHaveAttribute('aria-pressed', 'false')

  const upload = page.waitForResponse((r) => r.url().includes('/upload-image') && r.request().method() === 'POST')
  await page.getByRole('button', { name: /^crear receta$/i }).click()
  const uploaded = await upload
  expect(uploaded.status()).toBe(200)
  await page.waitForURL(/\/recipes\/[0-9a-f-]{36}\/edit$/, { timeout: 20_000 })
  const id = page.url().match(/recipes\/([0-9a-f-]{36})\/edit/)![1]

  // The create told the API not to make an AI photo, and nobody asked for one.
  expect(createUrls.some((u) => u.includes('ownPhoto=1'))).toBe(true)
  expect(aiCalls).toEqual([])

  // The editor shows it, offering both buttons.
  await expect(page.getByRole('button', { name: 'Subir mi foto' })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator(`img[src*="${id}.jpg"]`).first()).toBeVisible()

  // The recipe page shows our photo as the main one.
  await page.goto(`/recipes/${id}`)
  const hero = page.locator(`img[alt="${name}"]`).locator('visible=true').first()
  await expect(hero).toBeVisible({ timeout: 15_000 })
  await expect(hero).toHaveAttribute('src', new RegExp(`${id}\\.jpg`))
  await expect
    .poll(() => hero.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 15_000 })
    .toBeGreaterThan(0)
  expect(aiCalls).toEqual([])
})
