/**
 * WhatsApp-first linking: /whatsapp/conectar?t=<token>, the one-tap link an
 * unlinked number receives on WhatsApp. Covers the logged-out path through
 * /register?next=… (which must bring the user back here), the masked-number
 * confirmation, and expired links. /whatsapp/phone-token/* is mocked.
 */

import { test, expect, type Route } from '@playwright/test'
import { uniqueId } from './_helpers'

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

test('logged out → create account → back here → confirm the masked number', async ({ page }) => {
  let confirmed = false
  await page.route('**/whatsapp/phone-token/tok123', (route) =>
    json(route, { status: 'valid', phone: '+34 ••• ••• 222', profileName: 'Miguel', available: true }),
  )
  await page.route('**/whatsapp/phone-token/tok123/confirm', (route) => {
    confirmed = true
    return json(route, { linked: true, phone: '+34 ••• ••• 222', chatLink: 'https://wa.me/15550001111' })
  })

  await page.goto('/whatsapp/conectar?t=tok123')
  await page.getByRole('link', { name: /crear cuenta/i }).click()
  await expect(page).toHaveURL(/\/register\?next=%2Fwhatsapp%2Fconectar%3Ft%3Dtok123/)

  const id = uniqueId()
  await page.locator('input').nth(0).fill(`e2e_${id}`)
  await page.locator('input[type="email"]').fill(`e2e_${id}@test.local`)
  await page.locator('input[type="password"]').fill('e2epass123')
  await page.getByRole('button', { name: /crear|registr|empezar|continuar/i }).first().click()

  // `next` brings the new user straight back to the confirm page.
  await expect(page).toHaveURL(/\/whatsapp\/conectar\?t=tok123/, { timeout: 20_000 })
  await expect(page.getByTestId('whatsapp-connect-phone')).toHaveText('+34 ••• ••• 222 · Miguel')
  await page.getByRole('button', { name: /sí, conectar/i }).click()
  await expect(page.getByText('Listo')).toBeVisible()
  await expect(page.getByRole('link', { name: /volver a whatsapp/i })).toHaveAttribute('href', 'https://wa.me/15550001111')
  expect(confirmed).toBe(true)
})

test('an expired link explains how to get a new one', async ({ page }) => {
  const id = uniqueId()
  await page.goto('/register')
  await page.locator('input').nth(0).fill(`e2e_${id}`)
  await page.locator('input[type="email"]').fill(`e2e_${id}@test.local`)
  await page.locator('input[type="password"]').fill('e2epass123')
  await Promise.all([
    page.waitForURL(/\/onboarding|\/menu/, { timeout: 20_000 }),
    page.getByRole('button', { name: /crear|registr|empezar|continuar/i }).first().click(),
  ])

  await page.route('**/whatsapp/phone-token/old', (route) =>
    json(route, { status: 'expired', phone: '+34 ••• ••• 222', profileName: null, available: true }),
  )
  await page.goto('/whatsapp/conectar?t=old')
  await expect(page.getByText('Enlace caducado')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/escribe de nuevo a ona/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /sí, conectar/i })).toHaveCount(0)
})

test('login honours a relative next but ignores an off-site one (no open redirect)', async ({ page }) => {
  const apiUrl = process.env.API_URL ?? 'http://localhost:8765'
  const id = uniqueId()
  const creds = { username: `e2e_${id}`, email: `e2e_${id}@test.local`, password: 'e2epass123' }
  const reg = await page.request.post(`${apiUrl}/register`, { data: creds })
  expect(reg.ok()).toBe(true)

  const login = async (next: string) => {
    await page.goto(`/login?next=${encodeURIComponent(next)}`)
    await page.locator('input').nth(0).fill(creds.username)
    await page.locator('input[type="password"]').fill(creds.password)
    await page.getByRole('button', { name: /entrar|iniciar|acceder|continuar/i }).first().click()
  }

  await login('//evil.example.com/phish')
  await expect(page).toHaveURL(/localhost:\d+\/(menu|onboarding)/, { timeout: 20_000 })

  await page.evaluate(() => localStorage.clear())
  await login('/recipes')
  await expect(page).toHaveURL(/localhost:\d+\/recipes/, { timeout: 20_000 })
})
