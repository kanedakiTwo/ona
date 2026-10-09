/**
 * PRO-27: closed beta. With REGISTRATION_MODE=invite (the e2e API runs so,
 * see global-setup.ts) an account can only be created:
 *   - via a campaign link mimoia.com/i/<code> (counted per campaign in /admin/metrics);
 *   - with an email invited from the waitlist;
 *   - from a household invitation /invites/<token>;
 * and anyone else gets «Mimoia está en beta cerrada» + the waitlist link
 * (API: 403 REGISTRATION_INVITE_REQUIRED).
 */

import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, fillUntilEnabled, freshCreds, submitRegisterForm, uniqueId, type TestCreds } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'
const admin = () => ({ Authorization: `Bearer ${process.env.E2E_ADMIN_TOKEN}` })

test.skip(!process.env.E2E_CAMPAIGN_CODE, 'needs the closed-beta API (REGISTRATION_MODE=invite + ADMIN_EMAILS), see global-setup.ts')

/** Fill /register (already loaded) WITHOUT the e2e campaign and submit. */
async function submitBare(page: Page, creds: TestCreds) {
  await page.evaluate(() => sessionStorage.removeItem('ona.campana'))
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

test('no invitation → rejected and sent to the waitlist', async ({ page }) => {
  const api = await page.request.post(`${API_URL}/register`, {
    data: { ...freshCreds(), ageConfirmed: true },
  })
  expect(api.status()).toBe(403)
  expect((await api.json()).code).toBe('REGISTRATION_INVITE_REQUIRED')

  await page.goto('/register')
  await submitBare(page, freshCreds())
  const notice = page.getByTestId('closed-beta')
  await expect(notice).toContainText('Mimoia está en beta cerrada', { timeout: 15_000 })
  await expect(notice.getByRole('link', { name: /lista de espera/i })).toHaveAttribute('href', '/#lista-de-espera')
  expect(await page.evaluate(() => localStorage.getItem('ona_token'))).toBeNull()
})

test('campaign link: /i/<code> → account counted under its campaign', async ({ page }) => {
  test.setTimeout(60_000)
  const name = `camp-${uniqueId()}`
  const created = await page.request.post(`${API_URL}/admin/invite-campaigns`, { headers: admin(), data: { name, maxUses: 5 } })
  expect(created.status()).toBe(201)
  const campaign = await created.json()
  expect(campaign.url).toMatch(new RegExp(`/i/${campaign.code}$`))

  await page.goto(`/i/${campaign.code}`)
  await expect(page).toHaveURL(new RegExp(`/register\\?campana=${campaign.code}`))
  await submitRegisterBare(page)
  await expect(page).toHaveURL(/\/onboarding|\/menu/, { timeout: 20_000 })
  await completeOnboarding(page) // activity in the signup week

  const metrics = await (await page.request.get(`${API_URL}/admin/metrics?weeks=2`, { headers: admin() })).json()
  const row = metrics.campaigns.find((c: { campaign: string }) => c.campaign === name)
  expect(row).toMatchObject({ signups: 1 })
  const list = await (await page.request.get(`${API_URL}/admin/invite-campaigns`, { headers: admin() })).json()
  expect(list.find((c: { code: string }) => c.code === campaign.code).uses).toBe(1)
})

/** Submit /register keeping the ?campana= of the URL (no e2e campaign override). */
async function submitRegisterBare(page: Page) {
  const creds = freshCreds()
  const form = page.locator('form')
  const submit = form.getByRole('button', { name: /^crear cuenta/i })
  await fillUntilEnabled(submit, async () => {
    await form.locator('input').nth(0).fill(creds.username)
    await form.locator('input[type="email"]').fill(creds.email)
    await form.locator('input[type="password"]').fill(creds.password)
    await form.getByRole('checkbox', { name: 'Tengo 14 años o más' }).check()
  })
  await submit.click()
  return creds
}

test('email invited from the waitlist can sign up', async ({ page }) => {
  test.setTimeout(60_000)
  const email = `wlinv_${uniqueId()}@test.local`
  const joined = await page.request.post(`${API_URL}/waitlist`, {
    data: { email, householdSize: '2', plannerRole: 'yo', currentMethod: 'improviso', platform: 'android', consent: true },
  })
  expect(joined.ok()).toBe(true)
  // Invite the waiting batch (the e2e DB only holds test entries).
  const report = await (await page.request.get(`${API_URL}/admin/waitlist?batchSize=500`, { headers: admin() })).json()
  const invited = await page.request.post(`${API_URL}/admin/waitlist/invite`, {
    headers: admin(),
    data: { ids: report.suggestedNextBatch.ids },
  })
  expect(invited.ok()).toBe(true)
  expect(JSON.stringify(await invited.json())).toContain(email)

  await page.goto('/register')
  await submitBare(page, { ...freshCreds(), email })
  await expect(page).toHaveURL(/\/onboarding|\/menu/, { timeout: 20_000 })
})

test('household invitation always gets in', async ({ page, browser }) => {
  test.setTimeout(60_000)
  // Someone already in (via the e2e campaign) invites their household.
  await page.goto('/register')
  await submitRegisterForm(page, freshCreds())
  await expect(page).toHaveURL(/\/onboarding|\/menu/, { timeout: 20_000 })
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const inv = await page.request.post(`${API_URL}/households/me/invites`, { headers: { Authorization: `Bearer ${token}` }, data: {} })
  expect(inv.ok(), await inv.text()).toBe(true)
  const { token: inviteToken } = await inv.json()

  // A stranger with that link, logged out, no campaign.
  const ctx = await browser.newContext()
  const guest = await ctx.newPage()
  await guest.goto(`/invites/${inviteToken}`)
  await guest.getByRole('button', { name: /crear cuenta y aceptar/i }).click()
  await expect(guest).toHaveURL(/\/register\?next=/, { timeout: 15_000 })
  await submitBare(guest, freshCreds())
  await expect(guest).toHaveURL(new RegExp(`/invites/${inviteToken}`), { timeout: 20_000 })
  await ctx.close()
})
