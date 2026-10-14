/**
 * PRO-95: the Friday-menu box for beta households. Registering at 390×844
 * with «Quiero recibir cada viernes el menú de la semana por email» ticked
 * makes the account a newsletter recipient (an admin dry run says so); the
 * profile switch turns it off again.
 */

import { test, expect, type APIRequestContext } from '@playwright/test'
import { E2E_ADMIN } from './global-setup'
import { completeOnboarding, fillUntilEnabled, freshCreds, useE2ECampaign } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

const ISSUE = {
  issueId: 'e2e-optin',
  subject: 'E2E',
  content: {
    star: {
      title: 'Receta',
      body: 'Texto',
      imageUrl: 'https://mimoia.com/x.jpg',
      imageAlt: 'Foto',
      url: 'https://mimoia.com/r',
    },
    cta: { label: 'Abrir', url: 'https://mimoia.com/menu' },
  },
}

async function adminIncludes(request: APIRequestContext, email: string): Promise<boolean> {
  const login = await request.post(`${API_URL}/login`, {
    data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password },
  })
  expect(login.ok()).toBeTruthy()
  const { token, user } = await login.json()
  test.skip(user?.role !== 'admin', 'needs ADMIN_EMAILS on the API (see global-setup.ts)')
  const r = await request.post(`${API_URL}/admin/newsletter/send`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { ...ISSUE, dryRun: true, includes: email },
  })
  expect(r.ok()).toBeTruthy()
  return (await r.json()).includes
}

test('register with the newsletter box → recipient; the profile switch turns it off', async ({ page }) => {
  const creds = freshCreds()
  await page.goto('/register')
  await useE2ECampaign(page)
  const form = page.locator('form')
  const submit = form.getByRole('button', { name: /^crear cuenta/i })
  const box = form.getByRole('checkbox', { name: /quiero recibir cada viernes el menú de la semana por email/i })
  await expect(box).not.toBeChecked()
  await expect(form.getByText(/te lo recomendamos: te va a sorprender/i)).toBeVisible()

  await fillUntilEnabled(submit, async () => {
    await form.locator('input').nth(0).fill(creds.username)
    await form.locator('input[type="email"]').fill(creds.email)
    await form.locator('input[type="password"]').fill(creds.password)
    await form.getByRole('checkbox', { name: 'Tengo 14 años o más' }).check()
    await box.check()
  })
  await Promise.all([page.waitForURL(/\/onboarding|\/menu/, { timeout: 20_000 }), submit.click()])
  await expect.poll(() => adminIncludes(page.request, creds.email)).toBe(true)

  await completeOnboarding(page)
  await page.goto('/profile')
  const toggle = page.getByTestId('profile-newsletter').getByRole('button')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })
  await toggle.scrollIntoViewIfNeeded()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => adminIncludes(page.request, creds.email)).toBe(false)
})
