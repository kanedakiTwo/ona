/**
 * PRO-136 (specs/billing.md): the day-7 founder-price offer card (/menu,
 * Perfil → Suscripción and Mimo's panel) and the legal notice before the
 * first charge with its direct «Cancelar mi suscripción», at 390×844. The
 * offer only exists from launch day, so the spec answers `GET /billing` as
 * the API does on day 7 (the rule is tested in apps/api/src/tests/billing.test.ts
 * and founderOffer.test.ts).
 */

import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const TRIAL = { state: 'trial', trialEndsAt: '2027-01-24T23:00:00.000Z', trialLastDay: '2027-01-24', daysLeft: 7, trialDay: 7 }

async function billingAs(page: Page, over: Record<string, unknown>) {
  await page.route(/\/billing$/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: {
            enabled: true,
            beta: false,
            launchDate: '2026-12-15',
            canManage: true,
            firstChargeAt: '2027-02-02T11:00:00.000Z',
            access: TRIAL,
            founder: { household: false, priceIfSubscribing: true, offer: true },
            subscription: null,
            ...over,
          },
        })
      : route.continue(),
  )
}

test('day 7: the offer on /menu, in Mimo and on Suscripción', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  await billingAs(page, {})
  await page.goto('/menu')
  const card = page.getByTestId('founder-offer').first()
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card).toContainText('te quedas el precio de fundador para siempre')
  await expect(card).toContainText('dura hasta el 24 de enero')
  await expect(card).toContainText('No se cobra nada hasta el 2 de febrero de 2027')

  await page.getByTestId('mimo-button').click()
  await expect(page.getByTestId('mimo-founder-offer')).toContainText('precio de fundador para siempre')
  await expect(page.getByTestId('mimo-input')).toBeVisible()
  await page.keyboard.press('Escape')

  await card.getByTestId('founder-offer-cta').click()
  // The first visit compiles /profile/suscripcion in the dev server: more than
  // the default 5 s on CI (the first try failed day and night; PRO-273).
  await expect(page).toHaveURL(/\/profile\/suscripcion/, { timeout: 20_000 })
  await expect(page.getByTestId('founder-offer')).toContainText('Quédate el precio de fundador')
  await expect(page.getByTestId('subscribe-cta')).toBeVisible()
})

test('legal notice: date and amount, and the link opens the cancel flow', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  await billingAs(page, {
    access: { ...TRIAL, state: 'subscribed', daysLeft: null, trialDay: null },
    founder: { household: false, priceIfSubscribing: true, offer: false },
    subscription: {
      plan: 'esencial',
      period: 'mensual',
      status: 'trialing',
      nextChargeAt: '2027-02-02T11:00:00.000Z',
      cancelAtPeriodEnd: false,
      endsAt: null,
      founderPrice: true,
      upcomingCharge: { at: '2027-02-02T11:00:00.000Z', amount: '4,99 €' },
    },
  })
  let portalBody: unknown = null
  await page.route(/\/billing\/portal$/, async (route) => {
    portalBody = route.request().postDataJSON()
    await route.fulfill({ json: { url: '/profile?portal=cancel' } })
  })

  await page.goto('/menu')
  const notice = page.getByTestId('charge-notice')
  await expect(notice).toBeVisible({ timeout: 15_000 })
  await expect(notice).toContainText('El 2 de febrero de 2027 te cobraremos 4,99 €')
  await notice.getByRole('link', { name: 'Ver o cancelar mi suscripción' }).click()

  await expect(page).toHaveURL(/\/profile\/suscripcion\?cancelar=1/)
  await expect(page.getByTestId('subscription-founder')).toContainText('precio de fundador')
  await expect(page.getByTestId('charge-notice')).toContainText('cancela antes de esa fecha y no se te cobrará nada')
  await page.getByTestId('cancel-subscription').click()
  await expect(page).toHaveURL(/portal=cancel/)
  expect(portalBody).toEqual({ cancel: true })
})
