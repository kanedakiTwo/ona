/**
 * Pre-launch waitlist (specs/waitlist.md), against the real API + DB:
 *   - the hero CTA scrolls to the waitlist section;
 *   - filling the landing form shows the success state with the personal
 *     referral link, and the entry exists (GET /waitlist/:code);
 *   - visiting with `?invita=<code>` attributes the new signup to <code>,
 *     and the owner page /lista/<code> counts it;
 *   - the opt-out link from the success state takes the person off the list;
 *   - (2026-10-15) the form says why joining the beta helps and promises
 *     «Hogar fundador»; after sending, the success state scrolls into view
 *     (top of the card visible on a phone), asks to follow Mimoia on social
 *     media and never asks about price.
 */

import { test, expect, type Page } from '@playwright/test'
import { fillUntilEnabled, uniqueId } from './_helpers'

const apiUrl = process.env.API_URL ?? 'http://localhost:8765'

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

async function fillWaitlistForm(page: Page, email: string): Promise<void> {
  const section = page.locator('#lista-de-espera')
  const submit = section.getByRole('button', { name: /guárdame un sitio/i })
  await fillUntilEnabled(submit, async () => {
    await section.getByLabel('Tu email').fill(email)
    await section.getByRole('radio', { name: '3 o 4' }).click()
    await section.getByRole('radio', { name: 'Lo compartimos' }).click()
    await section.getByRole('radio', { name: 'Lista en papel o en notas' }).click()
    await section.getByRole('radio', { name: 'Android' }).click()
    await section.getByRole('checkbox', { name: /política de privacidad/i }).check()
  })
  await submit.click()
}

function codeFrom(url: string): string {
  const code = new URL(url).searchParams.get('invita')
  expect(code).toMatch(/^[0-9a-z]{8}$/)
  return code!
}

test('the hero CTA takes you to the waitlist', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: /quiero mi semana pensada/i }).first().click()
  await expect(page.locator('#waitlist-title')).toBeInViewport({ timeout: 10_000 })
  // Scrolled in place: the URL (and any ?invita=/ref=) is untouched.
  await expect(page).toHaveURL(/\/$/)
})

test('filling the landing form shows the success state with a personal referral link', async ({ page }) => {
  await page.goto('/?ref=e2e&utm_source=playwright')
  await fillWaitlistForm(page, `wl_${uniqueId()}@test.local`)

  const success = page.getByTestId('waitlist-success')
  await expect(success).toBeVisible({ timeout: 15_000 })
  await expect(success.getByRole('heading', { name: /invita a tu hogar/i })).toBeVisible()
  const link = await page.getByTestId('waitlist-referral-url').inputValue()
  const code = codeFrom(link)

  // Copy works, and the WhatsApp share carries the same link.
  await success.getByRole('button', { name: /copiar enlace/i }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(link)
  const wa = await success.getByRole('link', { name: /enviar por whatsapp/i }).getAttribute('href')
  expect(decodeURIComponent(wa!.replace('https://wa.me/?text=', ''))).toContain(link)

  // Stored for real: the public status endpoint knows the code.
  const status = await page.request.get(`${apiUrl}/waitlist/${code}`)
  expect(status.status()).toBe(200)
  expect((await status.json()).referredCount).toBe(0)
})

test('visiting with ?invita=<code> attributes the signup, and /lista/<code> counts it', async ({ page }) => {
  // The referrer signs up through the API (same payload shape as the form).
  const owner = await page.request.post(`${apiUrl}/waitlist`, {
    data: {
      email: `wl_owner_${uniqueId()}@test.local`,
      householdSize: '2',
      plannerRole: 'yo',
      currentMethod: 'improviso',
      platform: 'ios',
      consent: true,
    },
  })
  expect(owner.status()).toBe(200)
  const { code } = await owner.json()

  await page.goto(`/?invita=${code}`)
  await fillWaitlistForm(page, `wl_mate_${uniqueId()}@test.local`)
  await expect(page.getByTestId('waitlist-success')).toBeVisible({ timeout: 15_000 })

  const status = await (await page.request.get(`${apiUrl}/waitlist/${code}`)).json()
  expect(status.referredCount).toBe(1)

  await page.goto(`/lista/${code}`)
  await expect(page.getByTestId('waitlist-invited-count')).toHaveText('Has invitado a 1 persona.', { timeout: 15_000 })
  await expect(page.getByTestId('waitlist-referral-url')).toHaveValue(new RegExp(`/\\?invita=${code}$`))
})

test('the opt-out link from the success state takes you off the list', async ({ page }) => {
  await page.goto('/')
  await fillWaitlistForm(page, `wl_leave_${uniqueId()}@test.local`)
  const success = page.getByTestId('waitlist-success')
  await expect(success).toBeVisible({ timeout: 15_000 })
  const code = codeFrom(await page.getByTestId('waitlist-referral-url').inputValue())

  await success.getByRole('link', { name: /date de baja aquí/i }).click()
  await expect(page).toHaveURL(/\/lista\/baja\?t=/)
  await page.getByRole('button', { name: /darme de baja/i }).click()
  await expect(page.getByRole('heading', { name: /ya no estás en la lista/i })).toBeVisible({ timeout: 15_000 })

  expect((await page.request.get(`${apiUrl}/waitlist/${code}`)).status()).toBe(404)
})

test('mobile: why the beta, «Hogar fundador», back to the top after sending, social links and no price questions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const why = page.getByTestId('waitlist-why-beta')
  await expect(why).toContainText('nos ayudas a hacer Mimoia')
  await expect(why).toContainText('Hogar fundador')

  await fillWaitlistForm(page, `wl_top_${uniqueId()}@test.local`)
  const success = page.getByTestId('waitlist-success')
  await expect(success).toBeVisible({ timeout: 15_000 })
  // The heading of the success state, not the middle of it, is on screen.
  await expect(success.getByRole('heading', { name: /ya estás en la lista/i })).toBeInViewport({ timeout: 5_000 })

  const social = page.getByTestId('waitlist-social')
  await expect(social.getByRole('link', { name: /instagram/i })).toHaveAttribute('href', 'https://www.instagram.com/conmimoia/')
  await expect(social.getByRole('link', { name: /facebook/i })).toHaveAttribute('href', /facebook\.com/)
  // Price questions moved to the beta (a week in): none here.
  await expect(page.getByText(/€\/mes/)).toHaveCount(0)
  await expect(page.getByText(/precio de fundador/i)).toHaveCount(0)
})
