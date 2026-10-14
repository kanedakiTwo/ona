/**
 * /profile/memoria: «Guardar» keeps the text still in the box.
 *
 * Regression (2026-10-14): Miguel typed two nutrition beliefs and pressed
 * «Guardar» without the «+» button; the list was saved empty and the row
 * showed «—». The string-array editor now adds a valid draft on save.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('saving a belief without pressing + keeps it', async ({ page }) => {
  await page.goto('/profile/memoria')
  await page.getByRole('button', { name: /Principios nutricionales.*Añadir/ }).click()

  const box = page.getByPlaceholder('Ej. Ayuno intermitente 16/8')
  await box.fill('Mucho pescado azul')
  await page.getByRole('button', { name: 'Añadir', exact: true }).click()
  // The second one stays in the box: «Guardar» must keep it too.
  await box.fill('Nada de azúcar refinado')
  await page.getByRole('button', { name: 'Guardar' }).click()

  await expect(page.getByText('Mucho pescado azul, Nada de azúcar refinado')).toBeVisible({ timeout: 10_000 })

  // Persisted, not just local state.
  await page.reload()
  await expect(page.getByText('Mucho pescado azul, Nada de azúcar refinado')).toBeVisible({ timeout: 10_000 })
})
