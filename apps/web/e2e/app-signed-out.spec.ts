/**
 * The app without an account (specs/auth.md → "Public vs protected routes",
 * specs/recipes.md → "Catálogo público"): one rule for every page — open
 * pages are listed in lib/routeAccess.ts, every other one sends a signed-out
 * visitor to `/login?next=<path+query>` and logging in brings them back.
 * `/recipes` is the public catalogue signed out (public chrome, no
 * account-only bits, waitlist block) and the app's list signed in;
 * `/recipes-ona` is a permanent redirect to it.
 *
 * Every test starts from a clean browser context, so they run in any order
 * and in any CI shard.
 */

import { test, expect, type Page } from '@playwright/test'
import { e2eInvite, freshCreds, registerFreshUser, completeOnboarding, submitLoginForm } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

const PROTECTED = [
  '/menu',
  '/menu/history',
  '/shopping',
  '/compra',
  '/compra/tiendas?x=1',
  '/profile',
  '/profile/casa',
  '/advisor',
  '/recipes/new',
  '/recipes/00000000-0000-4000-8000-000000000000/edit',
  '/cookbooks/00000000-0000-4000-8000-000000000000',
  '/admin',
  '/onboarding',
]

async function expectPublicChrome(page: Page) {
  await expect(page.getByTestId('public-logo')).toBeVisible()
  await expect(page.getByTestId('site-footer')).toBeAttached()
  await expect(page.getByTestId('app-wordmark')).toHaveCount(0)
  await expect(page.getByTestId('mimo-button')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toHaveCount(0)
}

test('signed out, every page that needs an account goes to /login?next=<path+query>', async ({ page }) => {
  test.setTimeout(120_000)
  for (const path of PROTECTED) {
    await page.goto(path)
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 20_000 })
    expect(new URL(page.url()).searchParams.get('next'), path).toBe(path)
    await expect(page.getByRole('button', { name: /^entrar/i })).toBeVisible()
  }
})

test('/login?next= from a protected page: logging in lands back on it', async ({ page }) => {
  test.setTimeout(60_000)
  const creds = freshCreds()
  const reg = await page.request.post(`${API_URL}/register`, { data: { ...creds, ageConfirmed: true, ...e2eInvite() } })
  expect(reg.ok()).toBe(true)

  await page.goto('/shopping?desde=hoy')
  await page.waitForURL(/\/login\?next=%2Fshopping%3Fdesde%3Dhoy/, { timeout: 20_000 })
  await submitLoginForm(page, creds)
  await page.waitForURL((url) => url.pathname === '/shopping' && url.searchParams.get('desde') === 'hoy', { timeout: 20_000 })
  // The app shell, not the login form.
  await expect(page.getByRole('navigation', { name: 'Navegación principal', includeHidden: true }).first()).toBeAttached({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: /^entrar/i })).toHaveCount(0)
})

test('signed out, /recipes is the public catalogue: no account-only bits, a card opens the recipe, waitlist at the end', async ({ page }) => {
  await page.goto('/recipes')
  const card = page.getByTestId('recipe-card').first()
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expectPublicChrome(page)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Recetas')

  // Generic browsing filters stay.
  const chips = page.getByRole('group', { name: 'Filtros rápidos' })
  await expect(chips.getByRole('button', { name: 'De temporada' })).toBeVisible()
  await expect(chips.getByRole('button', { name: 'En 30 min' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Buscar recetas' })).toBeVisible()
  // Nothing that needs an account.
  for (const name of [/nueva receta/i, /mis recetas/i, /con lo que tengo/i, /selección mimoia/i]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0)
    await expect(page.getByRole('link', { name })).toHaveCount(0)
  }
  // «Más filtros» works without an account and has no "Recetas" group.
  await page.getByRole('button', { name: 'Más filtros' }).click()
  const sheet = page.getByRole('dialog', { name: 'Filtros' })
  await expect(sheet.getByRole('group', { name: 'Temporada' })).toBeVisible()
  await expect(sheet.getByRole('group', { name: 'Recetas' })).toHaveCount(0)
  await expect(sheet.getByText('Mis recetas')).toHaveCount(0)
  await sheet.getByRole('button', { name: 'Cerrar filtros' }).click()
  await expect(sheet).toHaveCount(0)

  const cta = page.getByTestId('recipes-waitlist-cta').getByRole('link', { name: /únete a la lista de espera/i })
  await cta.scrollIntoViewIfNeeded()
  await expect(cta).toBeVisible()
  await expect(cta).toHaveAttribute('href', '/?ref=recetas#lista-de-espera')

  const href = await card.getAttribute('href')
  expect(href).toMatch(/^\/recipes\/[^/]+$/)
  await card.scrollIntoViewIfNeeded()
  await Promise.all([page.waitForURL((url) => url.pathname === href, { timeout: 20_000 }), card.click()])
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })
  await expectPublicChrome(page)
})

test('signed out at 1440×900, /recipes sits on the public grid with no sidebar gap', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/recipes')
  await expect(page.getByTestId('recipe-card').first()).toBeVisible({ timeout: 20_000 })
  await expectPublicChrome(page)
  const main = await page.locator('main').boundingBox()
  const footer = await page.getByTestId('site-footer').boundingBox()
  const logo = await page.getByTestId('public-logo').boundingBox()
  const h1 = await page.getByRole('heading', { level: 1 }).boundingBox()
  expect(main?.x ?? -1).toBeLessThan(2)
  expect(footer?.x ?? -1).toBeLessThan(2)
  expect(Math.abs((h1?.x ?? 0) - (logo?.x ?? 100))).toBeLessThanOrEqual(2)
  await expect(page.getByRole('button', { name: /nueva receta/i })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /nueva receta/i })).toHaveCount(0)
})

test('/recipes-ona redirects permanently to /recipes keeping the query', async ({ request }) => {
  const res = await request.get('/recipes-ona?x=1', { maxRedirects: 0 })
  expect(res.status()).toBe(308)
  expect(res.headers()['location']).toBe('/recipes?x=1')
})

test('signed out at 1440×900, /whatsapp/conectar keeps its content with the public chrome and no gap', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/whatsapp/conectar')
  await expect(page.getByText(/entra en tu cuenta de mimoia/i)).toBeVisible({ timeout: 20_000 })
  await expectPublicChrome(page)
  await expect(page.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/login?next=%2Fwhatsapp%2Fconectar')
  const main = await page.locator('main').boundingBox()
  const logo = await page.getByTestId('public-logo').boundingBox()
  const h1 = await page.getByRole('heading', { level: 1 }).boundingBox()
  expect(main?.x ?? -1).toBeLessThan(2)
  expect(Math.abs((h1?.x ?? 0) - (logo?.x ?? 100))).toBeLessThanOrEqual(2)
})

test('signed in, /recipes is still the app list with «Nueva receta»', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  await page.goto('/recipes')
  await expect(page.getByRole('link', { name: 'Nueva receta' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Mis recetas' })).toBeVisible()
  await expect(page.getByTestId('public-logo')).toHaveCount(0)
  await expect(page.getByTestId('recipes-waitlist-cta')).toHaveCount(0)
})
