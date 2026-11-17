/**
 * PRO-387 (D-158, «camino recto»): /menu shows one next step above the menu,
 * never a stack (apps/web/src/lib/nextStep.ts; the order is unit-tested in
 * apps/api/src/tests/nextStepCard.test.ts). On a phone, a new account (here
 * without the health-data consent) sees one card at a time: «No tenemos tus
 * alergias», then «Manda la lista a quien hace la compra». «Ahora no» puts it
 * away for the week, and at most one card takes its place.
 */
import { test, expect } from '@playwright/test'
import { completeOnboarding, menuWithRecipesOn, registerFreshUser } from './_helpers'

const CARD_IDS = [
  'no-health-data-notice',
  'afina-notice',
  'account-paused',
  'charge-notice',
  'founder-offer',
  'trial-ending',
  'next-step-send-list',
  'next-step-last-night',
  'taste-card-offer',
  'whatsapp-nudge',
]

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
})

test('a new account sees a single card above the menu: safety first, then «Manda la lista»', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page, { keepNextSteps: true })
  // Lands on /menu: the health notice is shown (and stamped) on this first visit.
  await completeOnboarding(page)
  await expect(page.getByTestId('menu-week-range')).toBeVisible({ timeout: 20_000 })

  // Signed up without the health-data consent: «No tenemos tus alergias» first, alone.
  const health = page.getByTestId('no-health-data-notice')
  await expect(health).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(2_000)
  await expect(page.locator('[data-next-step]')).toHaveCount(1)
  await expect(page.getByTestId('next-step-send-list')).toHaveCount(0)
  await health.getByRole('button', { name: 'Entendido' }).click()
  await expect(health).toHaveCount(0)

  // «Manda la lista» needs a week with dishes: a new account's week is blank until generated.
  const apiUrl = process.env.API_URL ?? 'http://localhost:8765'
  const { token, userId, weekStart, todayIdx } = await page.evaluate(() => {
    const now = new Date()
    const back = now.getDay() === 0 ? 6 : now.getDay() - 1
    const monday = new Date(now)
    monday.setDate(now.getDate() - back)
    const iso = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
    return {
      token: localStorage.getItem('ona_token'),
      userId: JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string,
      weekStart: iso,
      todayIdx: back,
    }
  })
  const headers = { Authorization: `Bearer ${token}` }
  const gen = await page.request.post(`${apiUrl}/menu/generate`, { headers, data: { userId, weekStart } })
  expect(gen.ok(), `menu/generate ${gen.status()}`).toBeTruthy()
  await menuWithRecipesOn(page, headers, userId, weekStart, [[todayIdx, 'dinner']])
  await page.reload()
  await expect(page.getByTestId('menu-week-range')).toBeVisible({ timeout: 20_000 })

  const sendList = page.getByTestId('next-step-send-list')
  await expect(sendList).toBeVisible({ timeout: 20_000 })
  await expect(sendList.getByRole('heading')).toHaveText('Manda la lista a quien hace la compra')
  await expect(sendList.getByRole('link', { name: 'Ver y mandar la lista' })).toHaveAttribute('href', '/shopping')
  // Let every card's data arrive: still one.
  await page.waitForTimeout(2_000)
  await expect(page.locator('[data-next-step]')).toHaveCount(1)
  for (const id of CARD_IDS.filter((id) => id !== 'next-step-send-list')) {
    await expect(page.getByTestId(id), id).toHaveCount(0)
  }
  // The sheets wait while a next step is on screen.
  await expect(page.getByTestId('price-survey')).toHaveCount(0)

  // «Ahora no»: gone for the week, also after a reload; never two at once.
  await sendList.getByRole('button', { name: 'Ahora no' }).click()
  await expect(sendList).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('menu-week-range')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(2_000)
  await expect(page.getByTestId('next-step-send-list')).toHaveCount(0)
  expect(await page.locator('[data-next-step]').count()).toBeLessThanOrEqual(1)
})
