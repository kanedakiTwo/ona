/**
 * PRO-23 (LOPDGDD art. 7): sign-up needs «Tengo 14 años o más». Without the
 * box the form can't be sent (and the API answers 400, see
 * authRoute.smoke.ts); with it the account is created.
 */

import { test, expect } from '@playwright/test'
import { fillUntilEnabled, freshCreds, useE2ECampaign } from './_helpers'

test('register: blocked without the age box, works with it', async ({ page }) => {
  const creds = freshCreds()
  await page.goto('/register')
  await useE2ECampaign(page)
  const form = page.locator('form')
  const submit = form.getByRole('button', { name: /^crear cuenta/i })
  const age = form.getByRole('checkbox', { name: 'Tengo 14 años o más' })

  // All fields filled, box unticked → can't submit.
  await expect(async () => {
    await form.locator('input').nth(0).fill(creds.username)
    await form.locator('input[type="email"]').fill(creds.email)
    await form.locator('input[type="password"]').fill(creds.password)
    await expect(form.locator('input[type="password"]')).toHaveValue(creds.password)
  }).toPass({ timeout: 15_000 })
  await expect(age).not.toBeChecked()
  await expect(submit).toBeDisabled()

  // Ticked → account created, on to onboarding.
  await fillUntilEnabled(submit, async () => {
    await form.locator('input').nth(0).fill(creds.username)
    await age.check()
  })
  await Promise.all([page.waitForURL(/\/onboarding|\/menu/, { timeout: 20_000 }), submit.click()])
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user')))!)
  expect(user.ageConfirmedAt).toBeTruthy()
})
