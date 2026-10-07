/**
 * A stored token the API no longer accepts (JWT_SECRET rotated, tampered,
 * garbage) must log the user out and land them on /login, not leave every
 * authed page stuck on an error. The API answers 401 INVALID_TOKEN; the web
 * client wipes local auth on that code (lib/api.ts AUTH_RESET_CODES).
 */

import { test, expect } from '@playwright/test'

test('an invalid stored token sends the user to /login and clears the session', async ({ page }) => {
  await page.goto('/login')
  await page.evaluate(() => {
    localStorage.setItem('ona_token', 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4In0.bad-signature')
    localStorage.setItem(
      'ona_user',
      JSON.stringify({ id: '00000000-0000-0000-0000-000000000000', username: 'ghost', email: 'ghost@test.local', onboardingDone: true }),
    )
  })

  await page.goto('/menu')
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
  expect(await page.evaluate(() => localStorage.getItem('ona_token'))).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('ona_user'))).toBeNull()
})
