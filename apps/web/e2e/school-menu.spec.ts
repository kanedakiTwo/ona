/**
 * PRO-224: «Menú del cole» in /profile/casa shows only when the household has
 * a child (a «Niñ@» member). Discreet on purpose; without a child the
 * feature still works through Mimo.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding, freshCreds, e2eInvite } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('«Menú del cole» appears in Mi casa only with a child member', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/profile/casa')
  await expect(page.getByText(/mi casa/i).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('school-menu-link')).toHaveCount(0)

  // A child joins: the owner invites with the «Niñ@» role and the child accepts.
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const invite = await page.request.post(`${API_URL}/households/me/invites`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { role: 'child' },
  })
  expect(invite.ok()).toBe(true)
  const inviteToken = (await invite.json()).token as string
  const child = await page.request.post(`${API_URL}/register`, { data: { ...freshCreds(), ageConfirmed: true, ...e2eInvite() } })
  expect(child.ok()).toBe(true)
  const childToken = (await child.json()).token as string
  const accept = await page.request.post(`${API_URL}/invites/${inviteToken}/accept`, { headers: { Authorization: `Bearer ${childToken}` } })
  expect(accept.ok()).toBe(true)

  await page.reload()
  const link = page.getByTestId('school-menu-link')
  await expect(link).toBeVisible({ timeout: 10_000 })
  await link.click()
  // `next dev` may compile the route on this first visit (CI warms it first).
  await expect(page).toHaveURL(/\/profile\/casa\/cole/, { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: /Menú del cole/ })).toBeVisible()
  await expect(page.getByText('Aún no hay menú del cole guardado.')).toBeVisible()
})
