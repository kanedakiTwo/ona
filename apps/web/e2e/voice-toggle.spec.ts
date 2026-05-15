/**
 * Flow 5: turn on voice mode from the profile and verify the floating mic
 * FAB is reachable from any authed route.
 *
 * In CI we don't ship Picovoice access keys nor test against the real
 * OpenAI Realtime API — so the FAB tap won't yield a working session.
 * We only assert that:
 *   - The toggle in /profile flips the state
 *   - The FAB becomes visible app-wide afterwards
 *   - Tapping the FAB opens the voice overlay (which then auto-closes
 *     once the session attempt fails)
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.beforeEach(async ({ page, context }) => {
  // Pre-grant mic permission so the toggle's getUserMedia smoke check passes.
  await context.grantPermissions(['microphone'])

  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('toggle voice on → FAB visible → tap opens overlay', async ({ page }) => {
  // The toggle's first click in /profile triggers `getUserMedia({audio:true})`
  // and shows a native `alert()` if permission is denied. Playwright auto-
  // dismisses dialogs by default but accepting them up front makes the
  // failure path observable in the trace.
  page.on('dialog', (d) => { d.accept().catch(() => {}) })

  await page.goto('/profile')

  // The toggle lives under "Capítulo 04 — Modo voz" / "Modo manos libres".
  // It's a `<button aria-pressed>` whose text contains the chapter copy.
  const toggle = page
    .locator('button[aria-pressed]')
    .filter({ hasText: /modo voz|manos libres/i })
    .first()
  await expect(toggle).toBeVisible({ timeout: 10_000 })
  await toggle.click()

  // After click, `setEnabled(true)` writes to localStorage and React
  // re-renders. Wait for `aria-pressed=true` before asserting the FAB so
  // we don't race the re-render.
  await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 })

  // FAB should now be top-right on the same page (and on every authed page).
  // Pin to the FAB's exact aria-label (off-state "Abrir modo voz" or on-state
  // "Modo voz activo..."). The previous regex also matched the /profile toggle
  // button (which has "modo voz" in its text) and tripped strict-mode.
  const fab = page.getByRole('button', {
    name: /^(abrir modo voz|modo voz activo)/i,
  })
  await expect(fab).toBeVisible({ timeout: 5_000 })

  // Navigate to /menu to confirm the FAB stays mounted across routes.
  await page.goto('/menu')
  await expect(fab).toBeVisible({ timeout: 5_000 })

  // Tap the FAB. Expect the orb overlay to appear (z-50 fullscreen). In CI
  // the Realtime session can't reach OpenAI so the overlay can pass through
  // any of: "Conectando…" → "Te escucho." → "No se pudo conectar." →
  // "Sesión cerrada." → auto-close. Asserting on a specific phrase is racy;
  // assert on the overlay container instead (the only `.fixed.inset-0.z-50`
  // anywhere in the authed app) so the test stays stable regardless of how
  // far the session got before failing.
  await fab.click()
  const overlay = page.locator('div.fixed.inset-0.z-50').first()
  await expect(overlay).toBeVisible({ timeout: 10_000 })
})
