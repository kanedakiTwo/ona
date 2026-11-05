/**
 * PRO-386 (specs/billing.md): a failed payment, at 390×844. The real API has
 * no Stripe in CI, so the spec answers `GET /billing` as the API does with a
 * `past_due` subscription (the rule itself, 7 days and the notice once per
 * invoice, is tested in apps/api/src/tests/paymentFailures.test.ts), and
 * `POST /billing/portal` with a stand-in for Stripe's portal.
 */

import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

async function billingPastDue(page: Page, opts: { paused: boolean; canManage?: boolean }) {
  const portalCalls: unknown[] = []
  await page.route(/\/billing$/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: {
            enabled: true,
            beta: false,
            launchDate: '2026-12-15',
            canManage: opts.canManage ?? true,
            firstChargeAt: '2027-02-16T11:00:00.000Z',
            access: {
              state: opts.paused ? 'paused' : 'subscribed',
              trialDays: 14,
              trialEndsAt: '2026-12-28T23:00:00.000Z',
              trialLastDay: '2026-12-28',
              daysLeft: null,
              trialDay: null,
            },
            founder: { household: true, priceIfSubscribing: true, offer: false },
            subscription: {
              plan: 'esencial',
              period: 'mensual',
              status: 'past_due',
              nextChargeAt: '2027-02-10T11:00:00.000Z',
              cancelAtPeriodEnd: false,
              endsAt: null,
              founderPrice: true,
              upcomingCharge: null,
              paymentDueBy: '2027-02-17T11:00:00.000Z',
            },
          },
        })
      : route.continue(),
  )
  await page.route(/\/billing\/portal$/, (route) => {
    portalCalls.push(route.request().postDataJSON())
    return route.fulfill({ json: { url: '/precios?portal=stripe' } })
  })
  return portalCalls
}

test('failed payment: /menu shows «Pago pendiente» and «Cambiar la tarjeta» opens the portal', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  const portalCalls = await billingPastDue(page, { paused: false })
  await page.goto('/menu')
  const card = page.getByTestId('payment-pending').first()
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card).toContainText('Pago pendiente')
  await expect(card).toContainText('El pago no ha pasado')
  await expect(card).toContainText('antes del 17 de febrero')
  await expect(page.getByTestId('account-paused')).toHaveCount(0)

  await card.getByTestId('payment-pending-cta').click()
  await expect(page).toHaveURL(/portal=stripe/)
  expect(portalCalls).toHaveLength(1)
})

test('7 days later: the plan is paused until it pays, Mimo shows the same card', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  await billingPastDue(page, { paused: true })
  await page.goto('/menu')
  const card = page.getByTestId('payment-pending').first()
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card).toContainText('Tu plan está en pausa')
  await expect(card).toContainText('no se borra nada')
  // Not the trial's pause card.
  await expect(page.getByTestId('account-paused')).toHaveCount(0)

  await page.getByTestId('mimo-button').click()
  await expect(page.getByTestId('mimo-input')).toHaveCount(0)
  await expect(page.getByTestId('mimo-panel').getByTestId('payment-pending')).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto('/profile/suscripcion?tarjeta=1')
  await expect(page.getByTestId('subscription-payment-paused')).toContainText('tu plan está en pausa')
  await expect(page.getByTestId('subscription-badge')).toHaveText('Pago pendiente')
  await expect(page.getByTestId('change-card')).toBeVisible()
})

test('a member reads who changes the card, without the button', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  await billingPastDue(page, { paused: false, canManage: false })
  await page.goto('/menu')
  const card = page.getByTestId('payment-pending').first()
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card).toContainText('Avisa a quien gestiona tu hogar')
  await expect(card.getByTestId('payment-pending-cta')).toHaveCount(0)
})
