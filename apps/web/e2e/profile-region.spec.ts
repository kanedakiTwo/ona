/**
 * PRO-226: the household's comunidad autónoma in /profile/memoria (its
 * holidays count as weekend in the menu).
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('choosing the comunidad autónoma saves it', async ({ page }) => {
  await page.goto('/profile/memoria')
  await page.getByRole('button', { name: /Comunidad autónoma.*Añadir/ }).click()
  await page.getByLabel('Comunidad autónoma').selectOption('AR')
  await page.getByRole('button', { name: 'Guardar' }).click()

  await expect(page.getByText('Aragón', { exact: true })).toBeVisible({ timeout: 10_000 })
  await page.reload()
  await expect(page.getByText('Aragón', { exact: true })).toBeVisible({ timeout: 10_000 })
})
