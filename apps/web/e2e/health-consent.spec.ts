/**
 * PRO-21 (RGPD art. 9): health data only with the separate, unticked consent
 * box. Onboarding without it stores no allergies; with it they're stored
 * with date + version. Withdrawing it in the profile deletes them. Existing
 * users with data get a one-time screen. Without consent /menu says once
 * "No tenemos tus alergias…". Mobile (390×844).
 */

import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user')))!)
  return { auth: { Authorization: `Bearer ${token}` }, userId: user.id as string }
}

async function getUser(page: Page) {
  const s = await session(page)
  return (await page.request.get(`${API_URL}/user/${s.userId}`, { headers: s.auth })).json()
}

/** Walk the onboarding UI; on step 3 optionally tick the consent box and pick "sin gluten". */
async function onboard(page: Page, consent: boolean) {
  await page.goto('/onboarding')
  const next = page.getByRole('button', { name: /siguiente/i })
  await next.click()
  await page.getByRole('button', { name: /3-4 veces/i }).click()
  await next.click()
  const box = page.getByRole('checkbox', { name: /datos de salud/i })
  await expect(box).not.toBeChecked()
  const chip = page.getByRole('button', { name: /sin gluten/i })
  if (consent) {
    await box.check()
    await chip.click()
  } else {
    await expect(chip).toBeDisabled()
  }
  await next.click()
  await page.getByPlaceholder('Plato 1').fill('Lentejas')
  await next.click()
  await page.getByRole('button', { name: /salud/i }).click()
  await page.getByRole('button', { name: /empezar/i }).click()
  await expect(page).toHaveURL(/\/menu/, { timeout: 30_000 })
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
})

test('onboarding without the box stores no allergies; /menu says so once', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await onboard(page, false)

  const user = await getUser(page)
  expect(user.restrictions).toEqual([])
  expect(user.healthConsentAt).toBeNull()

  await expect(page.getByTestId('no-health-data-notice')).toContainText(
    'No tenemos tus alergias: revisa los ingredientes de cada receta',
    { timeout: 15_000 },
  )
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('no-health-data-notice')).toHaveCount(0)
})

test('onboarding with the box stores them with date and version; withdrawing deletes them', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await onboard(page, true)

  let user = await getUser(page)
  expect(user.restrictions).toEqual(['sin gluten'])
  expect(user.healthConsentVersion).toBe('salud-v1-2026-10')
  expect(user.healthConsentAt).toBeTruthy()
  await expect(page.getByTestId('no-health-data-notice')).toHaveCount(0)

  // Withdraw from the profile (confirm) → data gone, withdrawal recorded.
  await page.goto('/profile')
  const box = page.getByRole('checkbox', { name: /datos de salud/i })
  await expect(box).toBeChecked({ timeout: 15_000 })
  page.once('dialog', (d) => d.accept())
  await box.click()
  await expect(box).not.toBeChecked({ timeout: 10_000 })

  user = await getUser(page)
  expect(user.restrictions).toEqual([])
  expect(user.healthConsentWithdrawnAt).toBeTruthy()
})

test('existing users with health data are asked once', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await onboard(page, false)
  const s = await session(page)

  // An account from before the consent existed: data on file, never asked.
  // (No API path can create that state any more, so the state is mocked;
  // the answer goes to the real API.)
  await page.route(`**/user/${s.userId}/health-consent`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: { active: false, consentAt: null, version: null, withdrawnAt: null, hasHealthData: true, needsPrompt: true },
        })
      : route.continue(),
  )
  await page.goto('/recipes')
  const dialog = page.getByRole('dialog', { name: /seguimos guardándolos/i })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole('button', { name: 'Sí, consiento' }).click()
  await expect(dialog).toBeHidden()

  // Answered → the real state no longer asks.
  await page.unroute(`**/user/${s.userId}/health-consent`)
  const state = await (await page.request.get(`${API_URL}/user/${s.userId}/health-consent`, { headers: s.auth })).json()
  expect(state).toMatchObject({ active: true, needsPrompt: false, version: 'salud-v1-2026-10' })
  await page.goto('/recipes')
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('dialog', { name: /seguimos guardándolos/i })).toHaveCount(0)
})
