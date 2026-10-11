/**
 * Profile → «Mimo por voz» (D-023): the read-aloud preference lives in the
 * profile and in Mimo's panel, and both are the same setting. (The old
 * "modo voz" and its own floating mic are gone; so is the «Escuchar …»
 * activation-phrase switch, D-032.)
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('the profile has no «Escuchar …» switch and the old listener setting is cleared', async ({ page }) => {
  // A device that had the old listener on: the app deletes the setting on start.
  const legacyKey = 'ona.voice.wake' + 'word.enabled'
  await page.evaluate((k) => localStorage.setItem(k, '1'), legacyKey)
  await page.goto('/profile')
  const section = page.getByTestId('profile-mimo-voice')
  await expect(section).toBeVisible({ timeout: 10_000 })
  await expect(section.getByRole('button', { name: /leer las respuestas/i })).toBeVisible()
  await expect(page.getByText(/escuchar/i)).toHaveCount(0)
  await expect(page.getByText(/palabra de activación/i)).toHaveCount(0)
  await expect(page.getByTestId('mimo-button')).toHaveAttribute('aria-label', 'Hablar con Mimo')
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), legacyKey)).toBeNull()
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
