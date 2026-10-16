/**
 * Landing manifesto (specs/design-system.md → landing): Mimoia's mission,
 * vision and «efecto bola de nieve» are public on `/`, in the `#manifiesto`
 * section, so they can be linked (`/#manifiesto`) from social bios, press
 * and launch pages.
 *
 * The snowball pillar must only promise what the menu learns from today
 * (what you tell Mimo, favourites, vetoed recipes), never "every change"
 * (Legal review of 2026-10-16, Mimoia HQ approval «efecto bola de nieve»).
 */

import { test, expect } from '@playwright/test'

test('the landing shows the mission, the vision and the snowball effect', async ({ page }) => {
  await page.goto('/#manifiesto')

  const manifesto = page.locator('#manifiesto')
  await expect(
    manifesto.getByRole('heading', { name: /que en casa solo quede la parte divertida de cocinar/i }),
  ).toBeVisible({ timeout: 10_000 })

  await expect(manifesto.getByText('01 · La misión')).toBeVisible()
  await expect(manifesto).toContainText('Nuestra misión es quitar de en medio todo lo que no sea divertido')
  await expect(manifesto.getByText('02 · La visión')).toBeVisible()
  await expect(manifesto).toContainText('La cocina va a ser un refugio')
  await expect(manifesto.getByText('03 · El efecto bola de nieve')).toBeVisible()
  await expect(manifesto).toContainText('Cada cosa que le cuentas se queda')
  await expect(manifesto).not.toContainText(/según me vayas corrigiendo/i)
})
