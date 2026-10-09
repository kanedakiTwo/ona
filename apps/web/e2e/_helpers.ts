/**
 * Shared helpers for the Playwright E2E suite.
 */

import { expect, type Locator, type Page } from '@playwright/test'

/** Unique-per-run identifier — keeps DB state from colliding between specs. */
export function uniqueId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Fill a controlled form and keep re-filling until its submit button enables.
 *
 * `next dev` serves the SSR HTML before React has hydrated. A `fill()` that
 * lands in that window sets the DOM value but not React state, so the
 * auth forms (whose submit is `disabled` while any field is empty) stay
 * disabled forever — the spec then dies on a 30 s click timeout. Re-filling
 * until React reflects the values makes the step deterministic instead of
 * timing-dependent.
 */
export async function fillUntilEnabled(
  submit: Locator,
  fill: () => Promise<void>,
  timeout = 15_000,
): Promise<void> {
  await expect(async () => {
    await fill()
    await expect(submit).toBeEnabled({ timeout: 1_000 })
  }).toPass({ timeout })
}

export interface TestCreds {
  username: string
  email: string
  password: string
}

export function freshCreds(): TestCreds {
  const id = uniqueId()
  const username = `e2e_${id}`
  return { username, email: `${username}@test.local`, password: 'e2epass123' }
}

/**
 * Fill /register (already loaded) and click "Crear cuenta". Does not wait
 * for the redirect — callers assert where they expect to land.
 *
 * The register form labels (`Nombre de usuario`, `Email`, `Contrasena`) are
 * not wired to their inputs, so we target inputs by position/type.
 */
export async function submitRegisterForm(page: Page, creds: TestCreds): Promise<void> {
  // Closed beta (PRO-27): sign up through the e2e campaign link (global-setup.ts).
  await useE2ECampaign(page)
  const form = page.locator('form')
  const submit = form.getByRole('button', { name: /^crear cuenta/i })
  await fillUntilEnabled(submit, async () => {
    await form.locator('input').nth(0).fill(creds.username)
    await form.locator('input[type="email"]').fill(creds.email)
    await form.locator('input[type="password"]').fill(creds.password)
    await form.getByRole('checkbox', { name: 'Tengo 14 años o más' }).check()
  })
  await submit.click()
}

/** Fill /login (already loaded) and click "Entrar". */
export async function submitLoginForm(page: Page, creds: Pick<TestCreds, 'username' | 'password'>): Promise<void> {
  const form = page.locator('form')
  const submit = form.getByRole('button', { name: /^entrar/i })
  await fillUntilEnabled(submit, async () => {
    await form.locator('input').nth(0).fill(creds.username)
    await form.locator('input[type="password"]').fill(creds.password)
  })
  await submit.click()
}

/** Generate a fresh test user and register them via the UI. */
export async function registerFreshUser(page: Page): Promise<TestCreds> {
  const creds = freshCreds()
  await page.goto('/register')
  await Promise.all([
    page.waitForURL(/\/onboarding|\/menu/, { timeout: 20_000 }),
    submitRegisterForm(page, creds),
  ])
  return creds
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

  const res = await page.request.post(`${apiUrl}/user/${userId}/onboarding`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      adults: 1,
      kidsCount: 0,
      cookingFreq: 'daily',
      restrictions: [],
      favoriteDishes: ['pasta', 'pollo', 'ensalada'],
      priority: 'healthy',
    },
  })
  // Fail loudly: this used to send a stale payload and get a silent 400.
  if (!res.ok()) throw new Error(`onboarding failed: ${res.status()} ${await res.text()}`)

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

/**
 * Closed beta (PRO-27): the register form takes the campaign code from
 * `?campana=` or, after a detour, from sessionStorage. Put the e2e campaign
 * there so any /register (with or without ?next=) signs up through it.
 */
export async function useE2ECampaign(page: Page): Promise<void> {
  const code = process.env.E2E_CAMPAIGN_CODE
  if (!code) return
  await page.evaluate((c) => sessionStorage.setItem('ona.campana', c), code)
}

/** Body extras for API-level `POST /register` calls in specs. */
export function e2eInvite(): { inviteCode?: string } {
  return process.env.E2E_CAMPAIGN_CODE ? { inviteCode: process.env.E2E_CAMPAIGN_CODE } : {}
}
