/**
 * PRO-218: a fixed breakfast set in Perfil → «Tu semana tipo» (D-182, «Algo
 * fijo sin receta» with what it carries per person, copied to every day);
 * the next generated week shows «Fijo: Yogur con cereales» every day.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('a fixed breakfast set in «Tu semana tipo» goes into the generated week', async ({ page }) => {
  test.setTimeout(90_000)
  const loaded = page.waitForResponse((r) => r.url().includes('/households/me/week-type') && r.request().method() === 'GET')
  await page.goto('/profile/semana-tipo')
  await loaded
  // Breakfast isn't planned yet: show its column, then Monday's breakfast.
  await page.getByRole('button', { name: 'Desayuno' }).click()
  await page.getByTestId('wt-cell-0-breakfast').click()
  const panel = page.getByTestId('wt-panel')
  await panel.getByRole('button', { name: 'Hay desayuno este día' }).click()
  await panel.getByRole('button', { name: 'Añadir' }).click()
  const picker = page.getByTestId('wt-picker')
  await picker.getByRole('button', { name: 'Algo fijo sin receta' }).click()
  await picker.getByPlaceholder('Yogur con cereales').fill('Yogur con cereales')
  await picker.getByLabel('Cosa 1', { exact: true }).fill('yogur')
  await picker.getByRole('button', { name: 'Otra cosa' }).click()
  await picker.getByLabel('Cosa 2', { exact: true }).fill('cereales')
  await picker.getByLabel('Cantidad 2', { exact: true }).fill('40')
  await picker.getByLabel('Unidad 2', { exact: true }).selectOption('g')
  await picker.getByRole('button', { name: /Poner «Yogur con cereales»/ }).click()
  await expect(panel.getByRole('button', { name: 'Quitar Yogur con cereales' })).toBeVisible()
  // The same every other day.
  for (const day of ['martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']) {
    await panel.getByRole('button', { name: `Copiar al ${day}` }).click()
  }
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('wt-cell-6-breakfast')).toHaveAttribute('aria-label', 'Domingo, desayuno: Yogur con cereales')

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
  for (const day of menu.days) {
    expect(day.breakfast?.dishes?.[0]).toMatchObject({ kind: 'note', text: 'Fijo: Yogur con cereales', fixed: { items: [{ name: 'yogur', quantity: 1, unit: 'u' }, { name: 'cereales', quantity: 40, unit: 'g' }] } })
  }
})
