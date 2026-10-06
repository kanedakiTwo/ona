/**
 * WhatsApp-first linking: /whatsapp/conectar, the link an unlinked number
 * receives on WhatsApp. Covers the logged-out path through /register?next=…
 * (which must bring the user back here), then the code the user must send
 * FROM their WhatsApp (so a forwarded link can't link someone else's phone),
 * and the flip to "¡Listo!" once the phone sends it. /whatsapp/* is mocked.
 */

import { test, expect, type Route } from '@playwright/test'
import { uniqueId } from './_helpers'

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

test('logged out → create account → back here → send the code from WhatsApp → linked', async ({ page }) => {
  let status = { available: true, linked: false, phone: null as string | null, notify: false, chatLink: null as string | null }
  let codesMinted = 0
  await page.route('**/whatsapp/status', (route) => json(route, status))
  await page.route('**/whatsapp/link-code', (route) => {
    codesMinted += 1
    return json(route, {
      code: '4F7K2A',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      message: 'Vincular ONA: 4F7K2A',
      waLink: 'https://wa.me/15550001111?text=Vincular%20ONA%3A%204F7K2A',
    }, 201)
  })

  await page.goto('/whatsapp/conectar')
  await page.getByRole('link', { name: /crear cuenta/i }).click()
  await expect(page).toHaveURL(/\/register\?next=%2Fwhatsapp%2Fconectar/)

  const id = uniqueId()
  await page.locator('input').nth(0).fill(`e2e_${id}`)
  await page.locator('input[type="email"]').fill(`e2e_${id}@test.local`)
  await page.locator('input[type="password"]').fill('e2epass123')
  await page.getByRole('button', { name: /crear|registr|empezar|continuar/i }).first().click()

  // `next` brings the new user straight back, and the page mints a code.
  await expect(page).toHaveURL(/\/whatsapp\/conectar/, { timeout: 20_000 })
  await expect(page.getByTestId('whatsapp-connect-message')).toHaveText('Vincular ONA: 4F7K2A')
  await expect(page.getByRole('link', { name: /enviar desde whatsapp/i })).toHaveAttribute('href', /wa\.me\/15550001111\?text=/)
  expect(codesMinted).toBe(1)

  // The phone sends the code → the status poll reports linked.
  status = { available: true, linked: true, phone: '+34 ••• ••• 222', notify: true, chatLink: 'https://wa.me/15550001111' }
  await expect(page.getByText('Listo')).toBeVisible({ timeout: 8_000 })
  await expect(page.getByRole('link', { name: /volver a whatsapp/i })).toHaveAttribute('href', 'https://wa.me/15550001111')
})

test('explains when WhatsApp is not available for the account', async ({ page }) => {
  const id = uniqueId()
  await page.goto('/register')
  await page.locator('input').nth(0).fill(`e2e_${id}`)
  await page.locator('input[type="email"]').fill(`e2e_${id}@test.local`)
  await page.locator('input[type="password"]').fill('e2epass123')
  await Promise.all([
    page.waitForURL(/\/onboarding|\/menu/, { timeout: 20_000 }),
    page.getByRole('button', { name: /crear|registr|empezar|continuar/i }).first().click(),
  ])
  await page.route('**/whatsapp/status', (route) =>
    json(route, { available: false, linked: false, phone: null, notify: false, chatLink: null }),
  )
  await page.goto('/whatsapp/conectar')
  await expect(page.getByText('Aún no disponible')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('whatsapp-connect-message')).toHaveCount(0)
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

  // "/\t/evil.com": browsers drop the tab and would resolve it off-site.
  await page.evaluate(() => localStorage.clear())
  await login('/\t/evil.example.com')
  await expect(page).toHaveURL(/localhost:\d+\/(menu|onboarding)/, { timeout: 20_000 })

  await page.evaluate(() => localStorage.clear())
  await login('/recipes')
  await expect(page).toHaveURL(/localhost:\d+\/recipes/, { timeout: 20_000 })
})
