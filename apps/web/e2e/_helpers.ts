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

/** Skip onboarding by submitting the minimum required answers. */
export async function completeOnboarding(page: Page): Promise<void> {
  // Onboarding is a multi-step form. We accept any default selection by
  // clicking the primary CTA repeatedly until we land on /menu.
  // The exact wording can drift; we keep the button selector loose.
  for (let i = 0; i < 20; i++) {
    if (page.url().includes('/menu')) return
    if (!page.url().includes('/onboarding')) return
    const cta = page.getByRole('button', { name: /siguiente|continuar|empezar|listo|guardar/i }).last()
    if (await cta.isVisible().catch(() => false)) {
      await cta.click().catch(() => {})
      await page.waitForTimeout(300)
    } else {
      // No CTA found — break to avoid an infinite loop.
      break
    }
  }
}
