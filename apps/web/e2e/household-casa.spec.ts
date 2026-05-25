/**
 * Flow: /profile/casa — view solo household, generate an invite link.
 *
 * Every newly-registered user is auto-given a solo household named "Mi casa"
 * with themselves as the only member (role=owner). On /profile/casa they
 * should see:
 *   - the household name,
 *   - their own row with role badge,
 *   - a button to create an invite that produces a shareable URL.
 *
 * Regression test for PR 1A — without the household-management page this
 * spec is guaranteed to fail.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('shows solo household and generates an invite link', async ({ page }) => {
  await page.goto('/profile/casa')
  await expect(page).toHaveURL(/\/profile\/casa/)

  // The auto-created solo household defaults to "Mi casa".
  await expect(page.getByText(/mi casa/i).first()).toBeVisible({ timeout: 8_000 })

  // The current user is the single owner — owner badge is visible.
  await expect(page.getByText(/owner|propietari/i).first()).toBeVisible()

  // Two-step flow: first button opens the role-picker; second button
  // ("Crear invitación") actually persists the invite and surfaces the URL.
  await page.getByRole('button', { name: /invitar a alguien/i }).first().click()
  await page.getByRole('button', { name: /crear invitaci/i }).first().click()

  // The pending-invites list now carries an `/invites/<token>` URL.
  const inviteUrl = page.locator('text=/\\/invites\\//').first()
  await expect(inviteUrl).toBeVisible({ timeout: 8_000 })
})
