/**
 * PRO-49: /login greets everyone the same way — "Hola de nuevo." (no
 * gendered "Bienvenida de vuelta", no accent splitting a word) — and the
 * back link on the photo reads "Volver a inicio" without a double gap.
 */

import { test, expect } from '@playwright/test'

test('login shows a neutral title and a clean "Volver a inicio" link', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/login')

  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toHaveText('Hola de nuevo.')
  await expect(heading.locator('span.italic')).toHaveText('nuevo')
  await expect(page.getByText('Bienvenida de vuelta')).toHaveCount(0)

  const back = page.getByRole('link', { name: 'Volver a inicio', exact: true })
  await expect(back).toBeVisible()
  await expect(back).toHaveText('Volver a inicio')
})
