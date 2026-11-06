/**
 * PRO-1042: an account signed up through the API (as the WhatsApp bot does),
 * one adult saved and its menu made by Mimo, was sent from /menu back to the
 * first question of the sign-up, with two adults. Now /menu shows the menu, the
 * sign-up still to do is offered apart, and it opens with 1 adult filled in;
 * finishing it keeps Mimo's menu (no second one generated on top). 390×844.
 */
import { test, expect } from '@playwright/test'
import { e2eInvite, uniqueId } from './_helpers'
import { madridWeekStart } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

test('menu made by Mimo → /menu shows it, the sign-up offered apart with 1 adult', async ({ page }) => {
  test.setTimeout(120_000)

  // The account as Mimo leaves it: registered by the API, a household of 1, its menu made.
  const name = `mimo${uniqueId().replace(/-/g, '')}`.slice(0, 30)
  const reg = await page.request.post(`${API}/register`, {
    data: { username: name, email: `${name}@test.local`, password: 'e2epass123', ageConfirmed: true, ...e2eInvite() },
  })
  expect(reg.status()).toBe(201)
  const { token, user } = await reg.json()
  const headers = { Authorization: `Bearer ${token}` }
  const put = await page.request.put(`${API}/user/${user.id}`, { headers, data: { adults: 1, kidsCount: 0 } })
  expect(put.ok(), `adults: ${put.status()}`).toBeTruthy()
  const weekStart = madridWeekStart()
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId: user.id, weekStart } })
  expect(gen.ok(), `menu/generate ${gen.status()}`).toBeTruthy()
  const menuId = (await gen.json()).id as string
  // Not what this spec is about: the «Primeros pasos» guide and «Afina tu menú».
  expect((await page.request.post(`${API}/user/${user.id}/first-steps`, { headers })).ok()).toBeTruthy()
  expect((await page.request.post(`${API}/taste/offers`, { headers, data: { event: 'onboarding' } })).ok()).toBeTruthy()

  const status = await (await page.request.get(`${API}/user/${user.id}`, { headers })).json()
  expect(status).toMatchObject({ onboardingDone: false, onboardingRequired: false, onboardingPending: true, hasMenu: true })

  await page.addInitScript(
    ([t, u]) => {
      localStorage.setItem('ona_token', t)
      localStorage.setItem('ona_user', u)
    },
    [token, JSON.stringify(user)] as const,
  )

  // /menu stays on the menu, with the sign-up offered apart.
  await page.goto('/menu')
  const card = page.getByTestId('pending-sign-up')
  await expect(card).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1_500)
  await expect(page).toHaveURL(/\/menu/)
  await expect(page.getByText(/para cuántos cocinas/i)).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  // The sign-up opens with what is already known: 1 adult, 0 children.
  const generated: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/menu\/generate$/.test(r.url())) generated.push(r.url())
  })
  await card.getByRole('link', { name: 'Terminar el alta' }).click()
  await expect(page).toHaveURL(/\/onboarding/)
  const web = page.getByRole('button', { name: /prefiero la web/i })
  const household = page.getByRole('heading', { name: /para cuántos cocinas/i })
  await expect(web.or(household)).toBeVisible({ timeout: 15_000 })
  if (await web.isVisible()) await web.click()
  await expect(household).toBeVisible()
  const counters = page.locator('[aria-live="polite"]')
  await expect(counters.nth(0)).toHaveText('1')
  await expect(counters.nth(1)).toHaveText('0')

  // Finishing it lands on Mimo's menu, not a new one, and the card is gone.
  const next = page.getByRole('button', { name: /siguiente/i })
  await next.click()
  await page.getByRole('button', { name: /^batch cooking/i }).click()
  await next.click()
  await page.getByRole('button', { name: /^rápido/i }).click()
  await next.click()
  await page.getByRole('button', { name: /empezar/i }).click() // no restrictions
  await expect(page).toHaveURL(/\/menu/, { timeout: 30_000 })
  await expect(page.getByTestId('pending-sign-up')).toHaveCount(0)
  expect(generated).toEqual([])
  const after = await (await page.request.get(`${API}/menu/${user.id}/${weekStart}`, { headers })).json()
  expect(after.id).toBe(menuId)
  const done = await (await page.request.get(`${API}/user/${user.id}`, { headers })).json()
  expect(done).toMatchObject({ onboardingDone: true, adults: 1, kidsCount: 0, onboardingPending: false })
})
