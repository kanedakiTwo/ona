/**
 * Perfil → Borrar mi cuenta: a wrong password is refused in place; the right
 * one deletes the account, clears the session and lands on the landing.
 * Logging back in with the same credentials then fails.
 */

import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser, submitLoginForm } from './_helpers'

test('delete my account from the profile', async ({ page }) => {
  const creds = await registerFreshUser(page)
  await completeOnboarding(page)

  await page.goto('/profile')
  await page.getByRole('button', { name: /borrar mi cuenta/i }).click()
  await page.getByLabel(/contraseña para confirmar/i).fill('not-my-password')
  await page.getByRole('button', { name: /borrar definitivamente/i }).click()
  await expect(page.getByRole('alert').filter({ hasText: /contraseña no es correcta/i })).toBeVisible()

  await page.getByLabel(/contraseña para confirmar/i).fill(creds.password)
  await page.getByRole('button', { name: /borrar definitivamente/i }).click()
  await page.waitForURL(/\/\?cuenta=borrada/, { timeout: 20_000 })
  expect(await page.evaluate(() => localStorage.getItem('ona_token'))).toBeNull()

  await page.goto('/login')
  await submitLoginForm(page, creds)
  await expect(page).toHaveURL(/\/login/)
})
