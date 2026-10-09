/**
 * PRO-22: Aviso legal (LSSI art. 10) linked from the public footer, and the
 * privacy policy names the controller (RGPD art. 13): holder, NIF, address.
 */

import { test, expect } from '@playwright/test'

const OWNER = 'Miguel Martín Lacoma'
const NIF = '53390054Q'
const ADDRESS = 'Avenida de la Armada Española 13, 28660 Boadilla del Monte (Madrid)'

test('footer → /aviso-legal shows the holder; /privacidad names the controller', async ({ page }) => {
  await page.goto('/')
  const footer = page.getByTestId('site-footer')
  await footer.getByRole('link', { name: 'Aviso legal' }).click()
  await expect(page).toHaveURL(/\/aviso-legal$/, { timeout: 15_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Aviso legal' })).toBeVisible()
  const owner = page.getByTestId('legal-owner')
  await expect(owner).toContainText(OWNER)
  await expect(owner).toContainText(NIF)
  await expect(owner).toContainText(ADDRESS)
  await expect(owner).toContainText('hola@mimoia.com')
  await expect(page.getByText(/no es un producto sanitario/i)).toBeVisible()
  await expect(page.getByRole('link', { name: 'términos y condiciones' })).toHaveAttribute('href', '/terminos')
  await expect(page.getByRole('link', { name: 'política de privacidad' })).toHaveAttribute('href', '/privacidad')

  await page.goto('/privacidad')
  const controller = page.getByTestId('privacy-controller')
  await expect(controller).toContainText(OWNER)
  await expect(controller).toContainText(NIF)
  await expect(controller).toContainText(ADDRESS)
  await expect(controller).not.toContainText('el equipo de Mimoia')
})
