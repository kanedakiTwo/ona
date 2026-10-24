/**
 * PRO-354: creating the account on an iPhone, at 390×844, through each way in
 * of the beta — the waitlist invitation (/entrar/<token>), a campaign link
 * (/i/<code>), the landing with `?ref=` and `?invita=`, and /register?ref= —
 * and in a browser that gives the page no IndexedDB (some in-app browsers,
 * storage turned off). Each one must reach /onboarding with the session saved
 * and without a single uncaught error in the page.
 *
 * Runs in the `mobile-webkit` project (iPhone, WebKit) when WebKit is
 * installed, and in `mobile-chromium` always (playwright.config.ts).
 */

import { test, expect, type Page } from '@playwright/test'
import { e2eInvite, fillUntilEnabled, freshCreds, uniqueId, useE2ECampaign } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'
const admin = () => ({ Authorization: `Bearer ${process.env.E2E_ADMIN_TOKEN}` })

test.skip(!process.env.E2E_CAMPAIGN_CODE, 'needs the closed-beta API (REGISTRATION_MODE=invite + ADMIN_EMAILS), see global-setup.ts')
test.use({ viewport: { width: 390, height: 844 } })

/** Every uncaught error and unhandled rejection of the page, as WebKit words it. */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
  return errors
}

/** Fill the form (the email only when it isn't fixed by the invitation) and create the account. */
async function signUp(page: Page, opts: { emailFixed?: boolean } = {}) {
  const creds = freshCreds()
  const form = page.locator('form')
  const submit = form.getByRole('button', { name: /^crear cuenta/i })
  await fillUntilEnabled(submit, async () => {
    await form.locator('input').nth(0).fill(creds.username)
    if (!opts.emailFixed) await form.locator('input[type="email"]').fill(creds.email)
    await form.locator('input[type="password"]').fill(creds.password)
    await form.getByRole('checkbox', { name: 'Tengo 14 años o más' }).check()
  })
  await submit.click()
}

/** In: /onboarding drawn, the session in this browser, no error on the way. */
async function expectIn(page: Page, errors: string[]) {
  await expect(page).toHaveURL(/\/onboarding|\/menu/, { timeout: 20_000 })
  await expect(page.getByRole('button').first()).toBeVisible({ timeout: 15_000 })
  expect(await page.evaluate(() => localStorage.getItem('ona_token'))).toBeTruthy()
  await expect(page.locator('form [role="alert"]')).toHaveCount(0)
  expect(errors).toEqual([])
}

test('waitlist invitation: /entrar/<token> → account', async ({ page }) => {
  test.setTimeout(90_000)
  const email = `wlios_${uniqueId()}@test.local`
  const joined = await page.request.post(`${API_URL}/waitlist`, {
    data: { email, firstName: 'Lucía', householdSize: '2', plannerRole: 'yo', currentMethod: 'improviso', platform: 'ios', consent: true },
  })
  expect(joined.ok(), await joined.text()).toBe(true)
  const report = await (await page.request.get(`${API_URL}/admin/waitlist?batchSize=500`, { headers: admin() })).json()
  const invited = await page.request.post(`${API_URL}/admin/waitlist/invite`, {
    headers: admin(),
    data: { ids: report.suggestedNextBatch.ids, sendEmail: false },
  })
  expect(invited.ok()).toBe(true)
  const person = (await invited.json()).invited.find((p: { email: string }) => p.email === email)

  const errors = collectPageErrors(page)
  await page.goto(new URL(person.entryUrl).pathname)
  await expect(page).toHaveURL(/\/register\?entrada=/)
  await expect(page.getByTestId('waitlist-entry')).toContainText('¡Te toca, Lucía!', { timeout: 15_000 })
  await expect(page.locator('form input[type="email"]')).toHaveValue(email)
  await signUp(page, { emailFixed: true })
  await expectIn(page, errors)
})

test('campaign link: /i/<code> → account', async ({ page }) => {
  test.setTimeout(60_000)
  const created = await page.request.post(`${API_URL}/admin/invite-campaigns`, {
    headers: admin(),
    data: { name: `ios-${uniqueId()}`, maxUses: 5 },
  })
  expect(created.status()).toBe(201)
  const { code } = await created.json()

  const errors = collectPageErrors(page)
  await page.goto(`/i/${code}`)
  await expect(page).toHaveURL(new RegExp(`/register\\?campana=${code}`))
  await signUp(page)
  await expectIn(page, errors)
})

test('landing with ?ref= and ?invita= → /register → account', async ({ page, browser }) => {
  test.setTimeout(90_000)
  const id = uniqueId().replace(/-/g, '')
  const ctx = await browser.newContext()
  const reg = await ctx.request.post(`${API_URL}/register`, {
    data: { username: `ios${id}`.slice(0, 30), email: `ios${id}@test.local`, password: 'e2epass123', ageConfirmed: true, ...e2eInvite() },
  })
  expect(reg.status()).toBe(201)
  const { token } = await reg.json()
  const me = await (await ctx.request.get(`${API_URL}/referrals/me`, { headers: { Authorization: `Bearer ${token}` } })).json()
  await ctx.close()

  const errors = collectPageErrors(page)
  await page.goto(`/?ref=instagram&invita=${me.code}`)
  await page.waitForFunction(() => !!localStorage.getItem('ona.signupAttribution'), null, { timeout: 15_000 })
  await page.goto('/register')
  await useE2ECampaign(page)
  const body = page.waitForRequest((r) => r.url().endsWith('/register') && r.method() === 'POST')
  await signUp(page)
  expect((await body).postDataJSON()).toMatchObject({ invitedBy: me.code, signupSource: 'instagram' })
  await expectIn(page, errors)
})

test('/register?ref= straight from a link → account', async ({ page }) => {
  const errors = collectPageErrors(page)
  await page.goto('/register?ref=como-funciona')
  await useE2ECampaign(page)
  await signUp(page)
  await expectIn(page, errors)
})

test('a browser without IndexedDB still gets in (the account is not left half made)', async ({ page }) => {
  // What some iPhone in-app browsers and «storage off» give: no IndexedDB at all.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true })
  })
  const errors = collectPageErrors(page)
  await page.goto('/register')
  expect(await page.evaluate(() => typeof window.indexedDB)).toBe('undefined')
  await useE2ECampaign(page)
  await signUp(page)
  await expectIn(page, errors)
})
