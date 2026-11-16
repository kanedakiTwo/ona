/**
 * PRO-64: a restriction picked in onboarding is stored on the account
 * (`users.restrictions`) and the profile shows it as saved. Since PRO-1203
 * the allergies have one place: your row of «Quién come» in Perfil, which
 * opens «Tus alergias y tu dieta» (the account, what the menu reads).
 * Mobile (390×844).
 */

import { test, expect, type Page } from '@playwright/test'
import { answerShopper, registerFreshUser } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user')))!)
  return { auth: { Authorization: `Bearer ${token}` }, userId: user.id as string }
}

/** Onboarding with the health-data box ticked and "sin gluten" picked. */
async function onboardWithGlutenFree(page: Page) {
  await page.goto('/onboarding')
  const next = page.getByRole('button', { name: /siguiente/i })
  await next.click()
  await answerShopper(page) // PRO-383: two adults (the default)
  // PRO-217: «¿Cómo cocináis en casa?»
  await page.getByRole('button', { name: /^cocino cada día/i }).click()
  await next.click()
  // PRO-138: «Entre semana, ¿cómo te gusta cocinar?»
  await page.getByRole('button', { name: /sin prisa/i }).click()
  await next.click()
  await page.getByRole('checkbox', { name: /datos de salud/i }).check()
  await page.getByRole('button', { name: /sin gluten/i }).click()
  await page.getByRole('button', { name: /empezar/i }).click()
  await expect(page).toHaveURL(/\/menu/, { timeout: 30_000 })
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
})

/** Perfil → your row of «Quién come» → «Cambiar alergias y dieta». */
async function openMyAllergies(page: Page) {
  await page.goto('/profile')
  await page.getByTestId('who-eats').getByTestId('who-eats-row').first().click()
  await expect(page).toHaveURL(/\/profile\/quien\/me$/, { timeout: 15_000 })
  await page.getByRole('link', { name: 'Cambiar alergias y dieta' }).click()
  await expect(page).toHaveURL(/\/profile\/casa\/alergias/, { timeout: 15_000 })
}

/** «Guardar» there; the first week already has dishes, so leave it as it is. Back on your row. */
async function saveAndBack(page: Page) {
  await page.getByRole('button', { name: /^guardar$/i }).click()
  const keep = page.getByRole('button', { name: 'Dejar el menú tal cual' })
  await keep.or(page.getByTestId('person-page')).first().waitFor({ timeout: 15_000 })
  if (await keep.isVisible()) await keep.click()
  await expect(page).toHaveURL(/\/profile\/quien\/me$/, { timeout: 15_000 })
}

test('the profile shows the onboarding restriction and changing it keeps it on the account', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await onboardWithGlutenFree(page)

  // In your row of «Quién come», as a chip.
  await page.goto('/profile')
  await expect(page.getByTestId('who-eats-row').first()).toContainText('sin gluten', { timeout: 15_000 })

  await openMyAllergies(page)
  // Shown as a selected chip (with its «Quitar» button).
  await expect(page.getByRole('button', { name: 'Quitar sin gluten' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'vegetariano', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Quitar vegetariano' })).toBeVisible()
  await saveAndBack(page)

  const s = await session(page)
  const account = await (await page.request.get(`${API_URL}/user/${s.userId}`, { headers: s.auth })).json()
  expect(account.restrictions).toEqual(['sin gluten', 'vegetariano'])
  await expect(page.getByTestId('person-restrictions')).toContainText('vegetariano', { timeout: 15_000 })
  await expect(page.getByTestId('person-restrictions')).toContainText('sin gluten')
})

test('PRO-144: «sin alcohol» is a chip in onboarding and in the profile, and it is saved', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)

  // Onboarding offers it next to the allergies (enabled once the health box is ticked).
  await page.goto('/onboarding')
  const next = page.getByRole('button', { name: /siguiente/i })
  await next.click()
  await answerShopper(page) // PRO-383: two adults (the default)
  // PRO-217: «¿Cómo cocináis en casa?»
  await page.getByRole('button', { name: /^cocino cada día/i }).click()
  await next.click()
  // PRO-138: «Entre semana, ¿cómo te gusta cocinar?»
  await page.getByRole('button', { name: /sin prisa/i }).click()
  await next.click()
  await page.getByRole('checkbox', { name: /datos de salud/i }).check()
  await expect(page.getByRole('button', { name: /^sin alcohol$/i })).toBeEnabled()
  await expect(page.getByRole('button', { name: /^halal$/i })).toBeEnabled()
  await page.getByRole('button', { name: /sin gluten/i }).click()
  await page.getByRole('button', { name: /empezar/i }).click()
  await expect(page).toHaveURL(/\/menu/, { timeout: 30_000 })

  // In the profile: pick it and save.
  await openMyAllergies(page)
  await page.getByRole('button', { name: 'sin alcohol', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Quitar sin alcohol' })).toBeVisible()
  await saveAndBack(page)

  const s = await session(page)
  const account = await (await page.request.get(`${API_URL}/user/${s.userId}`, { headers: s.auth })).json()
  expect(account.restrictions).toEqual(['sin gluten', 'sin alcohol'])
  await expect(page.getByTestId('person-restrictions')).toContainText('sin alcohol', { timeout: 15_000 })
})

test('halal (2026-10-25) is a chip in onboarding and in the profile, and it is saved', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await onboardWithGlutenFree(page)

  // Onboarding offered it with the rest (the PRO-144 test walks that screen); here, the profile.
  await openMyAllergies(page)
  await expect(page.getByRole('button', { name: 'Quitar sin gluten' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'halal', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Quitar halal' })).toBeVisible()
  // Legal (E-19): Mimoia leaves pork and alcohol out; it doesn't certify anything.
  await expect(page.getByTestId('religion-consent')).toContainText('Sin cerdo ni alcohol. La carne y los productos, búscalos con sello halal.')
  await saveAndBack(page)

  const s = await session(page)
  const account = await (await page.request.get(`${API_URL}/user/${s.userId}`, { headers: s.auth })).json()
  expect(account.restrictions).toEqual(['sin gluten', 'halal'])
  await expect(page.getByTestId('person-restrictions')).toContainText('halal', { timeout: 15_000 })
})
