/**
 * Open registration (PRO-167, D-057; specs/waitlist.md «Open registration»).
 * The web reads the mode from `GET /public/config`:
 *   - `invite` (CI's API, the closed beta): everything as before, the
 *     waitlist form on the landing and «Quiero mi semana pensada» → the form;
 *   - `open` (mocked here, as `REGISTRATION_MODE=open` would answer): no
 *     waitlist form, every call to action says «Crea tu cuenta gratis» and
 *     goes to `/register` keeping `?ref`, `?invita` and `utm_*`; `/lista/<código>`
 *     still works.
 */
import { test, expect, type Page } from '@playwright/test'
import { uniqueId } from './_helpers'

const apiUrl = process.env.API_URL ?? 'http://localhost:8765'

async function openMode(page: Page) {
  await page.route(/\/public\/config$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ registration: 'open' }) }),
  )
}

test('the API says the mode in public (invite in CI)', async ({ request }) => {
  const r = await request.get(`${apiUrl}/public/config`)
  expect(r.ok()).toBe(true)
  expect(await r.json()).toEqual({ registration: 'invite' })
})

test('invite: the landing keeps the waitlist form and its CTA', async ({ page }) => {
  await page.goto('/?ref=circulo-miguel')
  await expect(page.locator('#lista-de-espera').getByRole('button', { name: /guárdame un sitio/i })).toBeVisible()
  const hero = page.getByTestId('hero-cta')
  await expect(hero).toHaveText(/Quiero mi semana pensada/)
  await expect(hero).toHaveAttribute('href', '#lista-de-espera')
  await expect(page.getByText('Crea tu cuenta gratis')).toHaveCount(0)
})

test('open: no waitlist form; «Crea tu cuenta gratis» → /register with ref, invita and utm', async ({ page }) => {
  await openMode(page)
  await page.goto('/?ref=circulo-miguel&invita=abcd2345&utm_source=ig&utm_campaign=nov')
  const hero = page.getByTestId('hero-cta')
  await expect(hero).toHaveText(/Crea tu cuenta gratis/)
  const href = await hero.getAttribute('href')
  const url = new URL(href!, 'http://x')
  expect(url.pathname).toBe('/register')
  expect(Object.fromEntries(url.searchParams)).toEqual({
    ref: 'circulo-miguel',
    invita: 'abcd2345',
    utm_source: 'ig',
    utm_campaign: 'nov',
  })
  await expect(page.locator('#lista-de-espera')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /guárdame un sitio/i })).toHaveCount(0)
  await expect(page.getByTestId('final-cta')).toHaveText(/Crea tu cuenta gratis/)

  await hero.click()
  await expect(page).toHaveURL(/\/register\?ref=circulo-miguel/)
  await expect(page.getByTestId('closed-beta')).toHaveCount(0)
})

test('open: /como-funciona, the blog and the mobile menu go to /register too', async ({ page }) => {
  await openMode(page)
  await page.goto('/como-funciona')
  await expect(page.getByTestId('como-funciona-cta')).toHaveAttribute('href', '/register?ref=como-funciona')
  await expect(page.getByTestId('como-funciona-cta')).toHaveText(/Crea tu cuenta gratis/)
  await expect(page.getByText('Entramos por tandas', { exact: false })).toHaveCount(0)

  await page.getByRole('button', { name: 'Abrir menú' }).click()
  await expect(page.getByTestId('public-nav-cta-mobile')).toHaveText(/Crea tu cuenta gratis/)
  await expect(page.getByTestId('public-nav-cta-mobile')).toHaveAttribute('href', '/register')
})

test('open: /lista/<código> still works', async ({ page }) => {
  const owner = await page.request.post(`${apiUrl}/waitlist`, {
    data: {
      email: `open_${uniqueId()}@test.local`,
      householdSize: '2',
      plannerRole: 'yo',
      currentMethod: 'improviso',
      platform: 'ios',
      consent: true,
      source: 'e2e',
    },
  })
  expect(owner.ok()).toBe(true)
  const { code } = await owner.json()
  await openMode(page)
  await page.goto(`/lista/${code}`)
  await expect(page.getByTestId('waitlist-invited-count')).toBeVisible()
})
