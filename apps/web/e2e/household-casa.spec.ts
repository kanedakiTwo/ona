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

// Regression (Miguel, 2026-10-14): on a phone the long `/invites/<token>`
// URL widened the whole single-column grid, so the members and invite cards
// spilled past the right edge of the screen.
test('the page fits the phone width with a pending invite', async ({ page }) => {
  await page.goto('/profile/casa')
  await page.getByRole('button', { name: /invitar a alguien/i }).first().click()
  await page.getByRole('button', { name: /crear invitaci/i }).first().click()
  await expect(page.locator('text=/\\/invites\\//').first()).toBeVisible({ timeout: 8_000 })

  const { scrollWidth, viewport } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(viewport)

  // Every card ends inside the screen (1 px of rounding slack).
  const vw = page.viewportSize()!.width
  for (const card of await page.locator('ul > li').all()) {
    const box = await card.boundingBox()
    if (box) expect(box.x + box.width).toBeLessThanOrEqual(vw + 1)
  }
})

// PRO-260 (D-088): «Enviar por WhatsApp» opens wa.me with the message
// already written and the invitation link; the tap counts the invite as
// sent. 390 px.
test.describe('390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('«Enviar por WhatsApp» opens wa.me with the written message and the link', async ({ page, context }) => {
    await page.goto('/profile/casa')
    await page.getByRole('button', { name: /invitar a alguien/i }).first().click()
    await page.getByRole('button', { name: /crear invitaci/i }).first().click()
    const code = page.locator('code', { hasText: /\/invites\// }).first()
    await expect(code).toBeVisible({ timeout: 8_000 })
    const inviteUrl = (await code.textContent())!.trim()
    expect(inviteUrl).toMatch(/\/invites\/[0-9a-f]{32}$/)

    const button = page.getByTestId('family-invite-whatsapp').first()
    await expect(button).toHaveText(/Enviar por WhatsApp/)
    const href = (await button.getAttribute('href'))!
    expect(href.startsWith('https://wa.me/?text=')).toBe(true)
    const text = decodeURIComponent(href.slice('https://wa.me/?text='.length))
    expect(text).toContain('Te invito a nuestra casa en Mimoia')
    expect(text).toContain('30 días')
    expect(text.endsWith(inviteUrl)).toBe(true)
    await expect(page.getByTestId('family-invite-copy').first()).toBeVisible()

    // Don't actually leave for wa.me: the new tab is closed as soon as it opens.
    context.on('page', (p) => void p.close().catch(() => {}))
    await page.route(/wa\.me/, (route) => route.fulfill({ status: 204, body: '' }))
    const shared = page.waitForResponse((r) => /\/households\/me\/invites\/[^/]+\/shared$/.test(r.url()) && r.request().method() === 'POST')
    await button.click()
    expect((await shared).status()).toBe(204)

    // The link expires in 30 days (shown as «Caduca <día mes>»).
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', timeZone: 'Europe/Madrid' })
    await expect(page.getByText(`Caduca ${expires}`).first()).toBeVisible()
  })
})
