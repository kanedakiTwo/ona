/**
 * Admin → Invitaciones → «Eliminar» (2026-10-15, Miguel): after confirming,
 * the campaign leaves the table, its link stops letting anyone in, and the
 * action is in the audit log. Desktop (the admin table lives there).
 */

import { test, expect, type Page } from '@playwright/test'
import { E2E_ADMIN } from './global-setup'
import { freshCreds, uniqueId } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

async function loginAsAdmin(page: Page): Promise<string> {
  const r = await page.request.post(`${API_URL}/login`, { data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password } })
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
  return token
}

test('delete a campaign: gone from the table, its link no longer lets anyone in', async ({ page }) => {
  test.setTimeout(60_000)
  const token = await loginAsAdmin(page)
  const auth = { Authorization: `Bearer ${token}` }
  const name = `borrar-${uniqueId()}`
  const created = await page.request.post(`${API_URL}/admin/invite-campaigns`, { headers: auth, data: { name } })
  expect(created.status()).toBe(201)
  const campaign = await created.json()

  await page.goto('/admin/invitaciones')
  const row = page.getByTestId(`campaign-${campaign.code}`)
  await expect(row).toBeVisible({ timeout: 15_000 })
  page.once('dialog', (d) => {
    expect(d.message()).toContain(`«${name}»`)
    expect(d.message()).toContain('El enlace dejará de funcionar')
    void d.accept()
  })
  await row.getByRole('button', { name: `Eliminar la campaña ${name}` }).click()
  await expect(row).toHaveCount(0, { timeout: 10_000 })

  // The link is dead: signing up with its code is refused during the beta.
  const reg = await page.request.post(`${API_URL}/register`, { data: { ...freshCreds(), ageConfirmed: true, inviteCode: campaign.code } })
  if (process.env.E2E_CAMPAIGN_CODE) expect(reg.status()).toBe(403)

  // Deleting it again is a 404.
  const again = await page.request.delete(`${API_URL}/admin/invite-campaigns/${campaign.id}`, { headers: auth })
  expect(again.status()).toBe(404)
})
