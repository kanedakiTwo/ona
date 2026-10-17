/**
 * PRO-135 (specs/billing.md): the paused account and choosing a plan, at
 * 390×844. Pausing only exists from launch day (2026-12-15), so the real API
 * says `beta` today: the spec answers `GET /billing` as the API does after
 * the trial (the rule itself is tested in apps/api/src/tests/accountAccess.test.ts).
 */

import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

type Access = { state: 'beta' | 'trial' | 'paused' | 'subscribed'; trialEndsAt: string; trialLastDay: string; daysLeft: number | null }

async function billingAs(page: Page, access: Access) {
  await page.route(/\/billing$/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: {
            enabled: true,
            beta: false,
            launchDate: '2026-12-15',
            canManage: true,
            firstChargeAt: '2027-02-16T11:00:00.000Z',
            access,
            subscription: null,
          },
        })
      : route.continue(),
  )
}

test('paused account: /menu says so, Mimo is off, «Elegir plan» opens the plans', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  await billingAs(page, { state: 'paused', trialEndsAt: '2027-01-24T23:00:00.000Z', trialLastDay: '2027-01-24', daysLeft: null })
  await page.goto('/menu')
  const card = page.getByTestId('account-paused').first()
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card).toContainText('Tu prueba ha terminado')
  await expect(card).toContainText('no se borra nada')

  // Mimo: no composer, the same notice.
  await page.getByTestId('mimo-button').click()
  await expect(page.getByTestId('mimo-input')).toHaveCount(0)
  await expect(page.getByTestId('mimo-panel').getByTestId('account-paused')).toBeVisible()
  await page.keyboard.press('Escape')

  await card.getByTestId('account-paused-cta').click()
  await expect(page).toHaveURL(/\/profile\/suscripcion/)
  await expect(page.getByTestId('subscription-paused')).toContainText('tu cuenta está en pausa')
  // Choosing a plan: the two plans and the pay button.
  await expect(page.getByTestId('subscribe-cta')).toHaveText(/Suscribirme a Esencial · pago el 16 de febrero/)
})

test('two days left: /menu warns once, with the last day', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  await billingAs(page, { state: 'trial', trialEndsAt: '2027-01-24T23:00:00.000Z', trialLastDay: '2027-01-24', daysLeft: 2 })
  await page.goto('/menu')
  const notice = page.getByTestId('trial-ending')
  await expect(notice).toBeVisible({ timeout: 15_000 })
  await expect(notice).toContainText('Te quedan 2 días de prueba')
  await expect(notice).toContainText('hasta el 24 de enero')
  await expect(page.getByTestId('account-paused')).toHaveCount(0)
})
