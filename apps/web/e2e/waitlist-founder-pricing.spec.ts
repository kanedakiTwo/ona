/**
 * PRO-26 (D-020/D-021): after joining the waitlist, four optional price
 * questions; only after answering, the founder plans (Esencial · Plus anual,
 * featured · Plus) and «Reservar mi plaza de fundador». Nothing is charged.
 * Mobile, against the real API + DB.
 */

import { test, expect } from '@playwright/test'
import { fillUntilEnabled, uniqueId } from './_helpers'

test('join → answer the 4 price questions → see the plans → reserve', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const section = page.locator('#lista-de-espera')
  const submit = section.getByRole('button', { name: /guárdame un sitio/i })
  await fillUntilEnabled(submit, async () => {
    await section.getByLabel('Tu email').fill(`fund_${uniqueId()}@test.local`)
    await section.getByRole('radio', { name: 'Dos' }).click()
    await section.getByRole('radio', { name: 'Yo', exact: true }).click()
    await section.getByRole('radio', { name: 'Improviso' }).click()
    await section.getByRole('radio', { name: 'iPhone' }).click()
    await section.getByRole('checkbox', { name: /política de privacidad/i }).check()
  })
  await submit.click()

  const pricing = page.getByTestId('founder-pricing')
  await expect(pricing).toBeVisible({ timeout: 15_000 })
  // The prices are not shown before the answers (they would anchor them).
  await expect(pricing.getByText('4,99 €/mes')).toHaveCount(0)

  const answers = { tooCheap: '1', good: '4', expensive: '7', tooExpensive: '12' }
  for (const [name, value] of Object.entries(answers)) {
    await pricing.locator(`input[name="${name}"]`).fill(value)
  }
  const saved = page.waitForResponse((r) => r.url().endsWith('/waitlist/pricing') && r.request().method() === 'POST')
  await pricing.getByRole('button', { name: 'Seguir' }).click()
  expect((await saved).ok()).toBe(true)

  // The plans, in order, Plus anual featured and preselected.
  await expect(pricing.getByRole('heading', { name: /reserva tu precio de fundador/i })).toBeVisible()
  const plans = pricing.getByRole('radio')
  await expect(plans).toHaveCount(3)
  await expect(plans.nth(0)).toContainText('Esencial')
  await expect(plans.nth(0)).toContainText('4,99 €/mes')
  await expect(plans.nth(1)).toContainText('Plus anual')
  await expect(plans.nth(1)).toContainText('Plus por 5 €/mes')
  await expect(plans.nth(1)).toHaveAttribute('aria-checked', 'true')
  await expect(plans.nth(2)).toContainText('8,99 €/mes')
  await expect(pricing).toContainText('Empiezas con 14 días gratis con todo, sin tarjeta')
  await expect(pricing.getByRole('button', { name: 'Ninguno me encaja' })).toBeVisible()

  // Reserve Esencial.
  await plans.nth(0).click()
  const reserved = page.waitForResponse((r) => r.url().endsWith('/waitlist/reservation') && r.request().method() === 'POST')
  await pricing.getByRole('button', { name: 'Reservar mi plaza de fundador' }).click()
  const res = await reserved
  expect(res.ok()).toBe(true)
  expect(await res.json()).toEqual({ ok: true, choice: 'esencial-mensual' })
  await expect(pricing.getByRole('status')).toContainText('Esencial · 4,99 €/mes')
})
