/**
 * The one WhatsApp reminder on /menu (PRO-107, specs/whatsapp.md): whoever
 * didn't connect WhatsApp sees «¿Te lo mando por WhatsApp?» once, after their
 * first week. The API decides when (`nudge` in GET /whatsapp/status, rule in
 * apps/api/src/tests/whatsappNudge.test.ts); showing it stamps it. The status
 * is mocked after the sign-up so the onboarding stays on the web path.
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function mockStatus(page: Page, status: { linked: boolean; nudge: boolean }) {
  const seen: string[] = []
  await page.route('**/whatsapp/status', (route) =>
    json(route, { available: true, phone: status.linked ? '+34 ••• ••• 222' : null, notify: false, prefs: {}, chatLink: null, ...status }),
  )
  await page.route('**/whatsapp/nudge/seen', (route) => {
    seen.push(route.request().method())
    return route.fulfill({ status: 204 })
  })
  return seen
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('not connected: the card shows once, is stamped as seen, and «Ahora no» removes it', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const seen = await mockStatus(page, { linked: false, nudge: true })
  await page.goto('/menu')

  const card = page.getByTestId('whatsapp-nudge')
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expect(card).toContainText('¿Te lo mando por WhatsApp?')
  await expect(card.getByRole('link', { name: /conectar whatsapp/i })).toHaveAttribute('href', '/whatsapp/conectar')
  await expect.poll(() => seen.length).toBe(1)

  await card.getByRole('button', { name: 'Ahora no' }).click()
  await expect(card).toBeHidden()
})

test('connected: no card', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const seen = await mockStatus(page, { linked: true, nudge: false })
  await page.goto('/menu')
  await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1500)
  await expect(page.getByTestId('whatsapp-nudge')).toHaveCount(0)
  expect(seen).toEqual([])
})
