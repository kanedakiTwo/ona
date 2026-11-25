/**
 * The section swipe follows the bottom tab bar, Cocinar included (PRO-403):
 * Menú → Cocinar → Compra with a finger. Cocinar became the second tab
 * (PRO-1107) but SwipeNavigator's NAV_ORDER skipped it, so a swipe from Menú
 * jumped straight to Compra and on /cocinar it did nothing.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser, touchSwipe } from './_helpers'

/** Right-to-left finger swipe across the page's h1, past the 30 % threshold. */
async function swipeLeftOnHeading(page: Page): Promise<void> {
  const h1 = page.getByRole('heading', { level: 1 }).first()
  await expect(h1).toBeVisible({ timeout: 15_000 })
  const box = (await h1.boundingBox())!
  const y = box.y + box.height / 2
  const w = page.viewportSize()!.width
  await touchSwipe(page, { x: w - 30, y }, { x: 30, y }, 24)
}

test('a finger swipe goes Menú → Cocinar → Compra', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  await page.goto('/menu')
  await swipeLeftOnHeading(page)
  await expect(page).toHaveURL(/\/cocinar$/, { timeout: 10_000 })
  await expect(page.getByRole('heading', { level: 1, name: /qué cocinamos/i })).toBeVisible({ timeout: 15_000 })

  await swipeLeftOnHeading(page)
  await expect(page).toHaveURL(/\/shopping/, { timeout: 10_000 })
})
