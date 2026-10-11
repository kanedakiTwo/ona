/**
 * PRO-48: password recovery (/reset) and household invitations
 * (/invites/<token>) are drawn like /login — no desktop sidebar, no bottom
 * bar, no Mimo button — even for a signed-in user, who is the one that
 * usually opens an invitation link.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser } from './_helpers'

test('/reset and /invites/<token> use the public chrome at 1440×900', async ({ page }) => {
  await registerFreshUser(page)
  await page.setViewportSize({ width: 1440, height: 900 })

  for (const path of ['/reset', '/invites/token-que-no-existe']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('app-wordmark')).toHaveCount(0)
    await expect(page.getByTestId('mimo-button')).toHaveCount(0)
  }
})
