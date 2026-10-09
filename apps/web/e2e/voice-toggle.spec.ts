/**
 * Profile → «Mimo por voz» (D-023): the read-aloud preference lives in the
 * profile and in Mimo's panel, and both are the same setting. (The old
 * "modo voz" with OpenAI Realtime and its own floating mic is gone.)
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('«Leer las respuestas en voz alta» in the profile is the same switch as in Mimo', async ({ page }) => {
  await page.goto('/profile')
  const section = page.getByTestId('profile-mimo-voice')
  await expect(section).toBeVisible({ timeout: 10_000 })
  const toggle = section.locator('button[aria-pressed]').filter({ hasText: /leer las respuestas/i })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')

  // Mimo's panel shows it on (same preference, survives navigation).
  await page.goto('/menu')
  await page.getByTestId('mimo-button').click()
  await expect(page.getByRole('button', { name: 'No leer las respuestas en voz alta' })).toBeVisible()

  // The old voice-mode button is gone for good.
  await expect(page.getByRole('button', { name: /abrir modo voz/i })).toHaveCount(0)
})
