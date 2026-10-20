/**
 * Perfil → Avisos (PRO-237, D-080; specs/notifications.md), against the real
 * API at 390×844. A fresh account has no WhatsApp and no phone notification:
 * every kind is on except the morning menu (opt-in, PRO-215), the prep alerts
 * say how to get them and the rest «Solo llega por WhatsApp». The switch saves (survives a reload) and the API
 * reports the same as the screen (what Mimo's get_alerts reads).
 */

import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

test('profile → Avisos: each alert, where it arrives, and a switch that saves', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  await page.goto('/profile')
  await page.getByTestId('profile-avisos-link').click()
  await expect(page).toHaveURL(/\/profile\/avisos/)
  await expect(page.getByRole('heading', { name: /Qué te llega y por dónde/ })).toBeVisible()

  const list = page.getByTestId('alerts-list')
  await expect(list.getByRole('button')).toHaveCount(7)
  await expect(page.getByTestId('alert-prep_alerts-channel')).toHaveText('Conecta WhatsApp o activa las notificaciones del móvil.')
  await expect(page.getByTestId('alert-weekly_nudge-channel')).toHaveText('Solo llega por WhatsApp.')
  // PRO-215: the morning menu only for whoever asks for it.
  await expect(page.getByTestId('alert-daily_brief')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('alerts-channels')).toContainText('WhatsApp: sin conectar.')
  // No horizontal scroll at phone width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  const nudge = page.getByTestId('alert-weekly_nudge')
  await expect(nudge).toHaveAttribute('aria-pressed', 'true')
  await nudge.click()
  await expect(nudge).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('alert-weekly_nudge-channel')).toHaveText('Apagado')

  await page.reload()
  await expect(page.getByTestId('alert-weekly_nudge')).toHaveAttribute('aria-pressed', 'false')

  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const r = await page.request.get(`${API_URL}/notifications/prefs`, { headers: { Authorization: `Bearer ${token}` } })
  expect(r.ok()).toBeTruthy()
  const body = await r.json()
  expect(body.kinds.find((k: { kind: string }) => k.kind === 'weekly_nudge')).toMatchObject({ on: false, channel: 'off' })
  expect(body.kinds.find((k: { kind: string }) => k.kind === 'prep_alerts')).toMatchObject({ on: true })
})
