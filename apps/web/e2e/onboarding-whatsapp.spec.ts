/**
 * WhatsApp-first sign-up (Miguel, 2026-10-10): when WhatsApp is available,
 * the first screen of /onboarding offers to do the first steps with Mimo in
 * the chat. Sending the code links the phone; Mimo asks there and builds the
 * first menu (complete_onboarding, covered in the API tests); this page
 * follows the account and lands on /menu when it's done. "Prefiero la web"
 * keeps the classic questions. /whatsapp/* and the account poll are mocked.
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { registerFreshUser } from './_helpers'

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function mockWhatsApp(page: Page) {
  const state = {
    status: { available: true, linked: false, phone: null as string | null, notify: false, chatLink: null as string | null },
    onboardingDone: false,
  }
  await page.route('**/whatsapp/status', (route) => json(route, state.status))
  await page.route('**/whatsapp/link-code', (route) =>
    json(route, {
      code: '4F7K2A',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      message: 'Vincular Mimoia: 4F7K2A',
      waLink: 'https://wa.me/15550001111?text=Vincular%20Mimoia%3A%204F7K2A',
    }, 201),
  )
  // The page follows the account (GET /user/:id) once linked.
  await page.route(/\/user\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const res = await route.fetch()
    const body = await res.json()
    return json(route, { ...body, onboardingDone: state.onboardingDone })
  })
  return state
}

test('WhatsApp first: send the code, Mimo writes, and the page lands on /menu when the chat is done', async ({ page }) => {
  test.setTimeout(60_000)
  const wa = await mockWhatsApp(page)
  await registerFreshUser(page)
  await page.goto('/onboarding')

  await expect(page.getByTestId('onboarding-channel')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: /dónde quieres hablar con mimo/i })).toBeVisible()
  await page.getByRole('button', { name: /por whatsapp/i }).click()

  await expect(page.getByTestId('onboarding-whatsapp-message')).toHaveText('Vincular Mimoia: 4F7K2A')
  await expect(page.getByRole('link', { name: /enviar desde whatsapp/i })).toHaveAttribute('href', /wa\.me\/15550001111\?text=/)

  // The phone sends the code → linked: Mimo is asking in the chat.
  wa.status = { available: true, linked: true, phone: '+34 ••• ••• 222', notify: false, chatLink: 'https://wa.me/15550001111' }
  await expect(page.getByTestId('onboarding-whatsapp-linked')).toBeVisible({ timeout: 8_000 })
  await expect(page.getByRole('link', { name: /abrir whatsapp/i })).toHaveAttribute('href', 'https://wa.me/15550001111')

  // complete_onboarding ran in the chat → the account is onboarded → /menu.
  wa.onboardingDone = true
  await expect(page).toHaveURL(/\/menu/, { timeout: 15_000 })
})

test('"Prefiero la web" keeps the classic first question, and Atrás goes back to the choice', async ({ page }) => {
  test.setTimeout(60_000)
  await mockWhatsApp(page)
  await registerFreshUser(page)
  await page.goto('/onboarding')

  await page.getByRole('button', { name: /prefiero la web/i }).click()
  await expect(page.getByRole('heading', { name: /para cuántos cocinas/i })).toBeVisible()
  await page.getByRole('button', { name: 'Atrás' }).click()
  await expect(page.getByTestId('onboarding-channel')).toBeVisible()
})
