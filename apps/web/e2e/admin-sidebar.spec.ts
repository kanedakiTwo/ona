/**
 * Admin areas in the desktop sidebar (Miguel, 2026-10-14: «no veo panel de
 * invitaciones» — the tab sat off-screen at the end of a hidden-scrollbar
 * row). Admins get an «Admin» block under the normal items; each area has
 * its own URL (/admin/invitaciones…). Normal users never see it.
 */

import { test, expect, type Page } from '@playwright/test'
import { E2E_ADMIN } from './global-setup'
import { completeOnboarding, registerFreshUser } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

/** Sign the browser in as the e2e admin through the API (same storage the app writes). */
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

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('admin opens Invitaciones from the sidebar', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin')
    const adminNav = page.getByRole('navigation', { name: 'Admin', exact: true })
    await expect(adminNav).toBeVisible({ timeout: 15_000 })
    await adminNav.getByRole('link', { name: 'Invitaciones' }).click()
    await expect(page).toHaveURL(/\/admin\/invitaciones$/)
    await expect(page.getByRole('button', { name: 'Crear enlace' })).toBeVisible({ timeout: 10_000 })
    await expect(adminNav.getByRole('link', { name: 'Invitaciones' })).toHaveAttribute('aria-current', 'page')
    // Its own heading; the catalogue's counts and tabs stay on Catálogo.
    await expect(page.getByRole('heading', { level: 1, name: 'Invitaciones' })).toBeVisible()
    await expect(page.getByText('ingredientes sin USDA', { exact: true })).toHaveCount(0)
    // «Voz» (retired voice mode) is not in the menu.
    await expect(adminNav.getByRole('link', { name: 'Voz' })).toHaveCount(0)
    // Back to the catalogue: its gap tabs are all visible, no sideways scroll.
    await adminNav.getByRole('link', { name: 'Catálogo' }).click()
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('button', { name: /Output de regen/ })).toBeInViewport()
    await expect(page.getByText('ingredientes sin USDA', { exact: true })).toBeVisible()
  })

  test('a normal user has no Admin block', async ({ page }) => {
    await registerFreshUser(page)
    // /menu needs the sign-up finished (PRO-178).
    await completeOnboarding(page)
    await expect(page.getByRole('complementary', { name: 'Navegación principal' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Admin', exact: true })).toHaveCount(0)
    // The sidebar logo leads to the menu (it used to lead nowhere).
    await page.goto('/profile')
    await page.getByRole('complementary', { name: 'Navegación principal' }).getByTestId('app-wordmark').click()
    await expect(page).toHaveURL(/\/menu$/)
  })
})

test('mobile: /admin/invitaciones opens the invitations directly', async ({ page }) => {
  await loginAsAdmin(page)
  await page.goto('/admin/invitaciones')
  await expect(page.getByRole('button', { name: 'Crear enlace' })).toBeVisible({ timeout: 15_000 })
})
