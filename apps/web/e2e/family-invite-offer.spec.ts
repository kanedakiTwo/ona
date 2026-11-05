/**
 * «Familia en el mismo hogar» (PRO-261, D-088; specs/household.md →
 * «Ofrecer la invitación»): the invitation is offered once the first time
 * the shopping list opens; «Te preparo el mensaje» turns into «Enviar por
 * WhatsApp» with the link. It doesn't come back. 390×844. The sign-up's
 * moment is «¿Quién hace la compra?» since PRO-383 (onboarding-shopper.spec.ts).
 */
import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser, skipFirstSteps, skipTasteOffer } from './_helpers'

const API = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

async function auth(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user'))) ?? '{}')
  return { headers: { Authorization: `Bearer ${token}` }, userId: user.id as string }
}

test('first visit to the shopping list: «Compártela con quien compra contigo», once', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  const { headers, userId } = await auth(page)
  const onboarding = await page.request.post(`${API}/user/${userId}/onboarding`, {
    headers,
    data: { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], priority: 'healthy' },
  })
  expect(onboarding.ok(), `onboarding ${onboarding.status()}`).toBeTruthy()
  await skipFirstSteps(page)
  await skipTasteOffer(page)
  await page.evaluate(() => {
    const u = JSON.parse(localStorage.getItem('ona_user') ?? '{}')
    u.onboardingDone = true
    localStorage.setItem('ona_user', JSON.stringify(u))
  })
  const weekStart = await page.evaluate(() => {
    const now = new Date()
    const monday = new Date(now)
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
  })
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart } })
  expect(gen.ok(), `menu/generate ${gen.status()}`).toBeTruthy()

  await page.goto('/shopping')
  const offer = page.getByTestId('family-invite-offer-compra')
  await expect(offer).toBeVisible({ timeout: 20_000 })
  await expect(offer).toContainText('Compártela con quien compra contigo')
  await offer.getByTestId('family-invite-prepare').click()
  await expect(offer.getByTestId('family-invite-whatsapp')).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=.*invites/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  // Second visit: gone.
  const status = page.waitForResponse((r) => r.url().endsWith('/households/me/family-offer') && r.request().method() === 'GET')
  await page.reload()
  expect(await (await status).json()).toMatchObject({ compra: false })
  await expect(page.getByRole('heading', { name: /lista de la compra/i })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('family-invite-offer-compra')).toHaveCount(0)
})
