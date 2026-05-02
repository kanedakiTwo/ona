/**
 * Shared helpers for the Playwright E2E suite.
 */

import type { Page } from '@playwright/test'

/** Unique-per-run identifier — keeps DB state from colliding between specs. */
export function uniqueId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Generate a fresh test user and register them via the UI. */
export async function registerFreshUser(page: Page): Promise<{ username: string; email: string; password: string }> {
  const id = uniqueId()
  const username = `e2e_${id}`
  const email = `${username}@test.local`
  const password = 'e2epass123'

  await page.goto('/register')

  // The register form labels use `Nombre de usuario`, `Email`, `Contrasena` (no
  // ñ in the source — see register/page.tsx). We target by text to stay
  // resilient to label-vs-input wiring choices.
  await page.locator('input').nth(0).fill(username)
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill(password)

  await Promise.all([
    page.waitForURL(/\/onboarding|\/menu/, { timeout: 20_000 }),
    page.getByRole('button', { name: /crear|registr|empezar|continuar/i }).first().click(),
  ])

  return { username, email, password }
}

/**
 * Skip onboarding by hitting the API directly with a sane default body. The
 * onboarding page is a 5-step form with option-button-driven steps that
 * each auto-advance on click — automating it through the UI is brittle and
 * slow. The dedicated `registration-onboarding.spec.ts` exercises the UI
 * surface (it just asserts we land somewhere valid); every other spec uses
 * this helper to skip ahead to `/menu` reliably.
 */
export async function completeOnboarding(page: Page): Promise<void> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:8765'

  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userRaw = await page.evaluate(() => localStorage.getItem('ona_user'))
  if (!token || !userRaw) return
  const userId = JSON.parse(userRaw).id as string

  await page.request.post(`${apiUrl}/user/${userId}/onboarding`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      householdSize: 'solo',
      cookingFreq: 'daily',
      restrictions: [],
      favoriteDishes: ['pasta', 'pollo', 'ensalada'],
      priority: 'healthy',
    },
  })

  // Reflect onboardingDone in the local copy so AuthProvider doesn't bounce
  // us back to /onboarding on the next navigation.
  await page.evaluate(() => {
    const raw = localStorage.getItem('ona_user')
    if (!raw) return
    const u = JSON.parse(raw)
    u.onboardingDone = true
    localStorage.setItem('ona_user', JSON.stringify(u))
  })

  await page.goto('/menu')
}
