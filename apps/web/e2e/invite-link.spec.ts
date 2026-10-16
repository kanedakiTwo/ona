/**
 * «Invitar a otro hogar» (PRO-162, specs/auth.md): someone opens the landing
 * with another account's `?invita=<code>`, goes to /register and signs up —
 * the sign-up carries that code (the API stores it as the inviter; storage
 * rules in accountReferrals.smoke.ts). 390×844.
 */
import { test, expect } from '@playwright/test'
import { e2eInvite, registerFreshUser, submitRegisterForm, uniqueId } from './_helpers'

const API = process.env.API_URL ?? 'http://localhost:8765'

test('landing with ?invita → /register → the sign-up carries the inviter’s code', async ({ browser }) => {
  test.setTimeout(90_000)
  // The inviter: an account and its link.
  const id = uniqueId().replace(/-/g, '')
  const reg = await (await browser.newContext()).request.post(`${API}/register`, {
    data: { username: `inv${id}`.slice(0, 30), email: `inv${id}@test.local`, password: 'e2epass123', ageConfirmed: true, ...e2eInvite() },
  })
  expect(reg.status()).toBe(201)
  const { token } = await reg.json()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const me = await (await ctx.request.get(`${API}/referrals/me`, { headers: { Authorization: `Bearer ${token}` } })).json()
  expect(me.link).toContain(`?invita=${me.code}`)

  // The invited person, in their own browser.
  const page = await ctx.newPage()
  await page.goto(`/?invita=${me.code}&ref=circulo-miguel`)
  await expect(page.locator('main')).toBeVisible({ timeout: 20_000 })
  await page.waitForFunction(() => !!localStorage.getItem('ona.signupAttribution'), null, { timeout: 15_000 })

  await page.goto('/register')
  const body = page.waitForRequest((r) => r.url().endsWith('/register') && r.method() === 'POST')
  await Promise.all([
    page.waitForURL(/\/onboarding|\/menu/, { timeout: 20_000 }),
    submitRegisterForm(page, { username: `fri${id}`.slice(0, 30), email: `fri${id}@test.local`, password: 'e2epass123' }),
  ])
  const sent = (await body).postDataJSON()
  expect(sent.invitedBy).toBe(me.code)
  expect(sent.signupSource).toBe('circulo-miguel')
  await ctx.close()
})

test('without ?invita the sign-up sends no inviter', async ({ page }) => {
  const body = page.waitForRequest((r) => r.url().endsWith('/register') && r.method() === 'POST')
  await registerFreshUser(page)
  expect((await body).postDataJSON().invitedBy).toBeUndefined()
})
