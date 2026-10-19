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

  // Cookieless visit statistics are disclosed; without NEXT_PUBLIC_CF_BEACON_TOKEN
  // (as in CI) no beacon is loaded at all.
  await expect(page.getByTestId('privacy-web-analytics')).toContainText('Cloudflare Web Analytics')
  await expect(page.getByTestId('privacy-web-analytics')).toContainText('sin cookies')
  // PRO-148: the web chat with Mimo is kept 90 days.
  await expect(page.getByTestId('privacy-web-chat')).toContainText('90 días')
  // PRO-151: Legal's text for the free sign-up note and the products ticked in the list.
  await expect(page.getByTestId('privacy-signup-shopping')).toContainText('Lo que nos cuentas al darte de alta y lo que compras')
  await expect(page.getByTestId('privacy-signup-shopping')).toContainText('Anthropic')
  await expect(page.locator('script[src*="cloudflareinsights"]')).toHaveCount(0)
})

// PRO-179: without NEXT_PUBLIC_SUPPORT_EMAIL (as in CI) the contact is hola@mimoia.com, never «quien te invitó».
test('/privacidad: the contact falls back to hola@mimoia.com', async ({ page }) => {
  await page.goto('/privacidad')
  const main = page.getByTestId('reading-column')
  await expect(main.locator('a[href="mailto:hola@mimoia.com"]').first()).toBeVisible()
  await expect(main).not.toContainText('te invitó a la beta')
})

// PRO-132: Legal's exact precisions on email (Resend, third-party advertising, the newsletter box).
test('/privacidad: Resend is a US company, no third-party advertising, the new newsletter box', async ({ page }) => {
  await page.goto('/privacidad')
  const main = page.getByTestId('reading-column')
  await expect(main).toContainText('Resend (empresa de EE. UU.)')
  await expect(main).toContainText('pero Resend puede tratar los datos en Estados Unidos.')
  await expect(main).toContainText('No vendemos tus datos ni los usamos para publicidad de terceros.')
  await expect(main).toContainText('No se comparten con nadie más ni se usan para publicidad de terceros.')
  await expect(main).toContainText('(art. 6.1.a RGPD y art. 21 de la LSSI)')
  await expect(main).toContainText('«Quiero recibir cada viernes por email una receta de la semana y novedades de Mimoia»')
  await expect(main).not.toContainText('envía desde la Unión Europea')
})

// PRO-70: the intended purpose (D-038, constitution §6), word for word, in its own section.
const INTENDED_PURPOSE =
  'Mimoia es un planificador de menús, recetas y lista de la compra para hogares, según sus gustos, preferencias y restricciones declaradas. Ofrece información general de alimentación. No está destinado a diagnosticar, prevenir, predecir, tratar ni controlar ninguna enfermedad, ni sustituye a un profesional sanitario.'

test('/terminos says what Mimoia is for, in the exact §6 words', async ({ page }) => {
  await page.goto('/terminos')
  await expect(page.getByRole('heading', { level: 2, name: /Para qué sirve Mimoia/ })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('terms-intended-purpose')).toHaveText(INTENDED_PURPOSE)
})
