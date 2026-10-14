/**
 * Newsletter opt-out (PRO-94, specs/newsletter.md), against the real API + DB:
 * someone on the waitlist with the Friday-menu box ticked opens the link from
 * the email, nothing happens until they press the button, then only the
 * newsletter is off — their place on the list (and their owner page) stays.
 */

import { test, expect } from '@playwright/test'
import { uniqueId } from './_helpers'

const apiUrl = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

test('the newsletter opt-out link turns off only the Friday menu', async ({ page }) => {
  const signup = await page.request.post(`${apiUrl}/waitlist`, {
    data: {
      email: `nl_${uniqueId()}@test.local`,
      householdSize: '2',
      plannerRole: 'yo',
      currentMethod: 'improviso',
      platform: 'ios',
      wantsWhatsapp: false,
      newsletterOptIn: true,
      consent: true,
      source: 'e2e',
    },
  })
  expect(signup.ok()).toBe(true)
  const { code, unsubscribeToken } = await signup.json()
  expect(unsubscribeToken).toBeTruthy()

  await page.goto(`/newsletter/baja?t=w.${unsubscribeToken}`)
  await expect(page.getByRole('heading', { name: /dejamos de mandarte el menú de los viernes/i })).toBeVisible()
  await expect(page.getByText(/tu sitio en la lista de espera sigue igual/i)).toBeVisible()

  // Loading the page changed nothing: the button is what unsubscribes.
  await page.getByRole('button', { name: 'No quiero recibirlo más' }).click()
  await expect(page.getByRole('heading', { name: /ya no te mandaremos el menú de los viernes/i })).toBeVisible()

  // A second time says so, and the place on the list is still there.
  await page.reload()
  await page.getByRole('button', { name: 'No quiero recibirlo más' }).click()
  await expect(page.getByRole('heading', { name: /ya no recibías el menú de los viernes/i })).toBeVisible()
  const status = await page.request.get(`${apiUrl}/waitlist/${code}`)
  expect(status.status()).toBe(200)
})

test('a bad newsletter link says it is not valid', async ({ page }) => {
  await page.goto('/newsletter/baja?t=w.no-existe-este-token-1234')
  await page.getByRole('button', { name: 'No quiero recibirlo más' }).click()
  await expect(page.getByRole('heading', { name: /este enlace de baja no es válido/i })).toBeVisible()
})
