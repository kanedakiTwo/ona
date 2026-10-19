/**
 * «Familia en el mismo hogar» (PRO-261, D-088; specs/household.md →
 * «Ofrecer la invitación»): the invitation is offered once in the sign-up
 * (2 adults or more) and once the first time the shopping list opens;
 * «Te preparo el mensaje» turns into «Enviar por WhatsApp» with the link.
 * Neither comes back. 390×844.
 */
import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser, skipFirstSteps, skipTasteOffer } from './_helpers'

const API = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

async function startWebQuestions(page: Page) {
  const web = page.getByRole('button', { name: /prefiero la web/i })
  const household = page.getByRole('heading', { name: /para cuántos cocinas/i })
  await expect(web.or(household)).toBeVisible({ timeout: 15_000 })
  if (await web.isVisible()) await web.click()
  await expect(household).toBeVisible()
}

async function auth(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user'))) ?? '{}')
  return { headers: { Authorization: `Bearer ${token}` }, userId: user.id as string }
}

test('sign-up with 2 adults: the offer shows once, prepares the WhatsApp message and does not come back', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await page.goto('/onboarding')
  await startWebQuestions(page)

  // Two adults (the default): the offer is there.
  await expect(page.locator('[aria-live="polite"]').nth(0)).toHaveText('2')
  const offer = page.getByTestId('family-invite-offer-alta')
  await expect(offer).toBeVisible({ timeout: 15_000 })
  await expect(offer).toContainText('¿Quieres que la otra persona vea también el menú y la lista?')

  // With one adult it hides; back to two, it's there again (same visit).
  await page.getByRole('button', { name: 'Quitar adulto' }).click()
  await expect(offer).toBeHidden()
  await page.getByRole('button', { name: 'Añadir adulto' }).click()
  await expect(offer).toBeVisible()

  const created = page.waitForResponse((r) => r.url().endsWith('/households/me/invites') && r.request().method() === 'POST')
  await offer.getByTestId('family-invite-prepare').click()
  const res = await created
  expect(res.status()).toBe(201)
  expect(JSON.parse(res.request().postData() ?? '{}')).toMatchObject({ source: 'alta' })
  const { token } = await res.json()
  const whatsapp = offer.getByTestId('family-invite-whatsapp')
  await expect(whatsapp).toBeVisible()
  const href = (await whatsapp.getAttribute('href'))!
  expect(href.startsWith('https://wa.me/?text=')).toBe(true)
  expect(decodeURIComponent(href)).toContain(`/invites/${token}`)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  // Never again: a new visit to the sign-up doesn't show it.
  const status = page.waitForResponse((r) => r.url().endsWith('/households/me/family-offer') && r.request().method() === 'GET')
  await page.reload()
  await startWebQuestions(page)
  expect(await (await status).json()).toMatchObject({ alta: false })
  await expect(page.getByTestId('family-invite-offer-alta')).toHaveCount(0)
})

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
