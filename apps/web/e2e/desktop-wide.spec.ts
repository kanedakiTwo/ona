/**
 * Big screens (Miguel, 2026-10-21, on a 2560 px monitor: «con pantallas muy
 * grandes el responsive no escala bien y no aprovecha bien el espacio»; «el
 * botón de salir debería estar en el menú, abajo a la izquierda»).
 *
 *   - App pages grow with the screen (`--page-max`: 1180 px on a laptop,
 *     1440 from 1680 px, 1680 from 2100 px, 1920 from 2400 px).
 *   - «Salir» sits at the bottom of the desktop sidebar and signs out.
 */
import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const containerWidth = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[class*="max-w-[var(--page-max)]"]') as HTMLElement | null
    return el ? el.getBoundingClientRect().width : 0
  })

test.describe('big screen (2560 × 1226)', () => {
  test.use({ viewport: { width: 2560, height: 1226 }, isMobile: false, hasTouch: false })

  test('the menu uses the width and «Salir» is at the bottom of the sidebar', async ({ page }) => {
    await registerFreshUser(page)
    await completeOnboarding(page)
    await page.goto('/menu')
    const sidebar = page.getByRole('complementary', { name: 'Navegación principal' })
    await expect(sidebar).toBeVisible({ timeout: 15_000 })

    // 1920 px of page on a 2560 px monitor, not the laptop's 1180.
    await expect.poll(() => containerWidth(page), { timeout: 15_000 }).toBeGreaterThan(1800)
    await page.goto('/recipes')
    await expect.poll(() => containerWidth(page), { timeout: 15_000 }).toBeGreaterThan(1800)

    // «Salir»: bottom left, one click, back to the landing with the session gone.
    const logout = sidebar.getByRole('button', { name: 'Salir' })
    await expect(logout).toBeVisible()
    const box = await logout.boundingBox()
    expect(box!.y).toBeGreaterThan(1226 - 160)
    await logout.click()
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
    expect(await page.evaluate(() => localStorage.getItem('ona_token'))).toBeNull()
  })
})

test.describe('laptop (1440 × 900)', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('a laptop keeps the 1180 px page', async ({ page }) => {
    await registerFreshUser(page)
    await completeOnboarding(page)
    await page.goto('/menu')
    await expect(page.getByRole('complementary', { name: 'Navegación principal' })).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => containerWidth(page), { timeout: 15_000 }).toBeLessThanOrEqual(1180)
  })
})
