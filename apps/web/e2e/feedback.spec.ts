/**
 * Beta feedback box (specs/feedback.md, 2026-10-15): the floating «Opinión»
 * pill opens a sheet; what's sent reaches GET /admin/feedback with the page,
 * and the agents' token sees it without identity. Mobile.
 */

import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser, uniqueId } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test('«Opinión» → write → Enviar → it reaches the admin list with the page', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) {
    // Not shown during onboarding.
    await expect(page.getByTestId('feedback-button')).toHaveCount(0)
    await completeOnboarding(page)
  }

  await page.goto('/shopping')
  const button = page.getByTestId('feedback-button')
  await expect(button).toBeVisible({ timeout: 15_000 })
  await button.click()
  const sheet = page.getByTestId('feedback-sheet')
  await expect(sheet.getByRole('heading', { name: 'Danos tu opinión' })).toBeVisible()
  const text = `Me gustaría ordenar la lista por tiendas ${uniqueId()}`
  await sheet.getByRole('textbox', { name: 'Tu opinión' }).fill(text)
  await sheet.getByRole('button', { name: 'Enviar' }).click()
  await expect(sheet.getByRole('status')).toContainText('Lo leemos todo')

  test.skip(!process.env.E2E_ADMIN_TOKEN, 'needs the admin token from global-setup.ts')
  const list = await (await page.request.get(`${API_URL}/admin/feedback?days=1`, { headers: { Authorization: `Bearer ${process.env.E2E_ADMIN_TOKEN}` } })).json()
  const item = list.items.find((i: { text: string }) => i.text === text)
  expect(item).toMatchObject({ channel: 'app', page: '/shopping' })
  expect(item.username).toBeTruthy()
})
