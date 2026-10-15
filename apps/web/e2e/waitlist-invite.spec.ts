/**
 * PRO-97: «Invitar tanda» from /admin/lista-espera, with the email.
 *
 * At 1440×900 and 390×844: the admin sees the suggested batch with names and
 * emails, removes one person, invites the rest after confirming, and the
 * simulated email (fake Resend, see global-setup.ts) gets one personal link
 * per invited person and none for the removed one. The link opens /register
 * with the email fixed and creates the account; using it again is an error;
 * registering an invited email WITHOUT the link is rejected.
 */

import { test, expect, type Browser, type Page } from '@playwright/test'
import { E2E_ADMIN } from './global-setup'
import { fillUntilEnabled, freshCreds, uniqueId } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'
const MAIL_URL = process.env.E2E_MAIL_URL

test.skip(!process.env.E2E_CAMPAIGN_CODE, 'needs the closed-beta API (REGISTRATION_MODE=invite + ADMIN_EMAILS), see global-setup.ts')
test.skip(!MAIL_URL, 'needs the simulated email (E2E_MAIL_URL + RESEND_BASE_URL on the API), see global-setup.ts')

const admin = () => ({ Authorization: `Bearer ${process.env.E2E_ADMIN_TOKEN}` })

async function loginAsAdmin(page: Page) {
  const r = await page.request.post(`${API_URL}/login`, {
    data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password },
  })
  expect(r.ok()).toBeTruthy()
  const { token, user } = await r.json()
  test.skip(user?.role !== 'admin', 'needs ADMIN_EMAILS on the API (see global-setup.ts)')
  await page.addInitScript(
    ([t, u]) => {
      localStorage.setItem('ona_token', t)
      localStorage.setItem('ona_user', u)
    },
    [token, JSON.stringify(user)] as const,
  )
}

/** Empty the queue (other specs leave waiting entries), then sign up three people of the target segment. */
async function seedThree(page: Page) {
  const report = await (await page.request.get(`${API_URL}/admin/waitlist?batchSize=500`, { headers: admin() })).json()
  if (report.suggestedNextBatch.ids.length > 0) {
    const cleared = await page.request.post(`${API_URL}/admin/waitlist/invite`, {
      headers: admin(),
      data: { ids: report.suggestedNextBatch.ids, sendEmail: false },
    })
    expect(cleared.ok()).toBe(true)
  }
  const id = uniqueId()
  const people = ['Ana', 'Bruno', 'Carmen'].map((firstName) => ({
    firstName,
    email: `wl_${firstName.toLowerCase()}_${id}@test.local`,
  }))
  for (const p of people) {
    const r = await page.request.post(`${API_URL}/waitlist`, {
      data: {
        ...p,
        householdSize: '2',
        plannerRole: 'yo',
        currentMethod: 'improviso',
        platform: 'android',
        wantsWhatsapp: p.firstName === 'Ana',
        consent: true,
      },
    })
    expect(r.ok()).toBe(true)
  }
  return people
}

async function mailsTo(page: Page, email: string): Promise<Array<{ subject: string; html: string; text: string }>> {
  return (await page.request.get(`${MAIL_URL}/__messages?to=${encodeURIComponent(email)}`)).json()
}

function linkPath(text: string): string {
  const m = text.match(/\/entrar\/([A-Za-z0-9_-]{43})/)
  expect(m, 'the email carries /entrar/<token>').not.toBeNull()
  return `/entrar/${m![1]}`
}

async function inviteFromAdmin(page: Page, people: Array<{ email: string }>) {
  const batch = page.getByTestId('waitlist-batch')
  for (const p of people) await expect(batch.getByText(p.email)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('waitlist-person')).toHaveCount(3)
  await expect(batch.getByText('Ana', { exact: true })).toBeVisible()

  // Miguel removes Carmen from this batch.
  await page.getByRole('button', { name: `Quitar a ${people[2].email}` }).click()
  await expect(page.getByTestId('waitlist-person')).toHaveCount(2)

  await page.getByRole('button', { name: 'Invitar a estas 2 personas' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('¿Invitar a 2 personas?')
  await dialog.getByRole('button', { name: /Sí, invitar/ }).click()
  await expect(page.getByTestId('waitlist-invite-result')).toContainText('2 personas invitadas', { timeout: 15_000 })
  await expect(page.getByTestId('waitlist-invite-result')).toContainText('Correos: 2 enviados')
  await expect(page.getByTestId('waitlist-batches')).toBeVisible()
}

async function checkEmailsAndRegister(page: Page, browser: Browser, people: Array<{ email: string; firstName: string }>, viewport: { width: number; height: number }) {
  // One email per invited person, each with its own link; none for the removed one.
  const [ana, bruno, carmen] = await Promise.all(people.map((p) => mailsTo(page, p.email)))
  expect(ana).toHaveLength(1)
  expect(bruno).toHaveLength(1)
  expect(carmen).toHaveLength(0)
  expect(ana[0].subject).toBe('¡Te toca, Ana! Ya puedes entrar en Mimoia')
  expect(ana[0].html).toContain('Crear mi cuenta')
  expect(ana[0].text).toContain('WhatsApp')
  expect(bruno[0].text).not.toContain('WhatsApp')
  const anaLink = linkPath(ana[0].text)
  expect(linkPath(bruno[0].text)).not.toBe(anaLink)

  // Ana opens her link, logged out: /register with her email fixed → account.
  const ctx = await browser.newContext({ viewport })
  const guest = await ctx.newPage()
  await guest.goto(anaLink)
  await expect(guest).toHaveURL(/\/register\?entrada=/)
  await expect(guest.getByTestId('waitlist-entry')).toContainText('¡Te toca, Ana!', { timeout: 15_000 })
  const emailField = guest.locator('form input[type="email"]')
  await expect(emailField).toHaveValue(people[0].email)
  await expect(emailField).toHaveAttribute('readonly', '')
  const creds = freshCreds()
  const form = guest.locator('form')
  const submit = form.getByRole('button', { name: /^crear cuenta/i })
  await fillUntilEnabled(submit, async () => {
    await form.locator('input').nth(0).fill(creds.username)
    await form.locator('input[type="password"]').fill(creds.password)
    await form.getByRole('checkbox', { name: 'Tengo 14 años o más' }).check()
  })
  await submit.click()
  await expect(guest).toHaveURL(/\/onboarding|\/menu/, { timeout: 20_000 })
  await ctx.close()

  // The same link again: error, no form to submit.
  const again = await browser.newContext({ viewport })
  const p2 = await again.newPage()
  await p2.goto(anaLink)
  await expect(p2.getByTestId('waitlist-entry-error')).toContainText('ya se ha usado', { timeout: 15_000 })
  await expect(p2.locator('form').getByRole('button', { name: /^crear cuenta/i })).toBeDisabled()
  await again.close()

  // Bruno is invited but tries /register WITHOUT his link: rejected, told to use the email's button.
  const api = await page.request.post(`${API_URL}/register`, {
    data: { ...freshCreds(), email: people[1].email, ageConfirmed: true },
  })
  expect(api.status()).toBe(403)
  expect((await api.json()).code).toBe('WAITLIST_INVITE_LINK_REQUIRED')

  const bare = await browser.newContext({ viewport })
  const p3 = await bare.newPage()
  await p3.goto('/register')
  const c3 = freshCreds()
  const f3 = p3.locator('form')
  const s3 = f3.getByRole('button', { name: /^crear cuenta/i })
  await fillUntilEnabled(s3, async () => {
    await f3.locator('input').nth(0).fill(c3.username)
    await f3.locator('input[type="email"]').fill(people[1].email)
    await f3.locator('input[type="password"]').fill(c3.password)
    await f3.getByRole('checkbox', { name: 'Tengo 14 años o más' }).check()
  })
  await s3.click()
  await expect(p3.locator('form [role="alert"]')).toContainText('Crear mi cuenta', { timeout: 15_000 })
  expect(await p3.evaluate(() => localStorage.getItem('ona_token'))).toBeNull()
  await bare.close()
}

test.describe('desktop 1440×900', () => {
  const viewport = { width: 1440, height: 900 }
  test.use({ viewport, isMobile: false, hasTouch: false })

  test('invite a batch from the sidebar, one link per person, single use', async ({ page, browser }) => {
    test.setTimeout(120_000)
    await loginAsAdmin(page)
    const people = await seedThree(page)
    await page.goto('/admin')
    const adminNav = page.getByRole('navigation', { name: 'Admin', exact: true })
    await adminNav.getByRole('link', { name: 'Lista de espera' }).click()
    await expect(page).toHaveURL(/\/admin\/lista-espera$/)
    await expect(adminNav.getByRole('link', { name: 'Lista de espera' })).toHaveAttribute('aria-current', 'page')
    await inviteFromAdmin(page, people)
    await checkEmailsAndRegister(page, browser, people, viewport)
  })
})

test.describe('mobile 390×844', () => {
  const viewport = { width: 390, height: 844 }
  test.use({ viewport })

  test('invite a batch, one link per person, single use', async ({ page, browser }) => {
    test.setTimeout(120_000)
    await loginAsAdmin(page)
    const people = await seedThree(page)
    await page.goto('/admin/lista-espera')
    await inviteFromAdmin(page, people)
    // No sideways scroll on a phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    await checkEmailsAndRegister(page, browser, people, viewport)
  })
})
