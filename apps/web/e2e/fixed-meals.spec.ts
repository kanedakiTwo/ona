/**
 * PRO-218: mark a fixed breakfast from Perfil → Plantilla semanal → Comidas
 * fijas; it stays after saving, and the next generated week shows
 * «Fijo: Yogur con cereales» every day.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('a fixed breakfast from the profile goes into the generated week', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/profile')
  const section = page.getByRole('region', { name: 'Comidas fijas' })
  await section.getByRole('button', { name: 'Añadir comida fija' }).click()
  await expect(section.getByLabel('Comida fija')).toHaveValue('breakfast')
  await section.getByPlaceholder('Yogur con cereales').fill('Yogur con cereales')
  await section.getByLabel('Cosa 1').fill('yogur')
  await section.getByRole('button', { name: 'Otra cosa' }).click()
  await section.getByLabel('Cosa 2').fill('cereales')
  await section.getByLabel('Cantidad 2').fill('40')
  await section.getByLabel('Unidad 2').selectOption('g')
  await section.getByRole('button', { name: 'Marcar como fija' }).click()
  await expect(section.getByTestId('fixed-meals')).toContainText('Desayuno: Yogur con cereales')
  await expect(section.getByTestId('fixed-meals')).toContainText('todos los días · 1 yogur, 40 g de cereales')

  await page.getByRole('button', { name: /guardar cambios/i }).click()
  await expect(page.getByText(/guardado/i).first()).toBeVisible({ timeout: 10_000 })
  await page.reload()
  await expect(page.getByTestId('fixed-meals')).toContainText('Desayuno: Yogur con cereales', { timeout: 10_000 })

  // The next week, generated: breakfast is the fixed one every day.
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 14)
  const weekStart = d.toISOString().slice(0, 10)
  const gen = await page.request.post(`${API_URL}/menu/generate`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { userId, weekStart },
  })
  expect(gen.ok()).toBe(true)
  const menu = await gen.json()
  for (const day of menu.days) expect(day.breakfast?.dishes?.[0]?.text).toBe('Fijo: Yogur con cereales')
})
