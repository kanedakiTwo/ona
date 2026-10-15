/**
 * One recipe page (specs/recipes.md → "Página de receta"): `/recipes/<id>` is
 * the only recipe detail. Signed out it opens with the public chrome
 * (PublicNavbar + Footer, no app sidebar / bottom bar / Mimo) and ends with
 * the waitlist block; signed in it keeps the app shell. The old public detail
 * `/recipes-ona/<id>` is a permanent redirect. The public catalogue list is
 * `/recipes` itself (e2e/app-signed-out.spec.ts).
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

async function catalogueRecipe(request: APIRequestContext): Promise<{ id: string; name: string }> {
  // Anonymous list = the Mimoia catalogue only.
  const [recipe] = await (await request.get(`${API_URL}/recipes?perPage=1`)).json()
  expect(recipe?.id, 'seeded catalogue recipe').toBeTruthy()
  return recipe
}

async function expectPublicChrome(page: Page) {
  await expect(page.getByTestId('public-logo')).toBeVisible()
  await expect(page.getByTestId('site-footer')).toBeAttached()
  await expect(page.getByTestId('app-wordmark')).toHaveCount(0)
  await expect(page.getByTestId('mimo-button')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toHaveCount(0)
}

test('signed out: a catalogue recipe opens complete, with the public chrome and the waitlist CTA', async ({ page, request }) => {
  const recipe = await catalogueRecipe(request)
  await page.goto(`/recipes/${recipe.id}?ref=receta`)

  await expect(page.getByRole('heading', { level: 1, name: recipe.name })).toBeVisible({ timeout: 20_000 })
  await expectPublicChrome(page)

  // The recipe itself: ingredients and steps.
  await expect(page.getByRole('tabpanel', { name: /ingredientes/i }).getByRole('listitem').first()).toBeVisible()
  await page.getByRole('tab', { name: /^pasos/i }).click()
  await expect(page.getByRole('tabpanel', { name: /pasos/i }).getByRole('listitem').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /compartir receta/i }).first()).toBeVisible()

  // No personal bits for a visitor.
  await expect(page.getByRole('button', { name: /añadir al menú/i })).toHaveCount(0)

  // Waitlist block at the end of the page.
  const cta = page.getByTestId('recipe-waitlist-cta').getByRole('link', { name: /únete a la lista de espera/i })
  await cta.scrollIntoViewIfNeeded()
  await expect(cta).toBeVisible()
  await expect(cta).toHaveAttribute('href', '/?ref=receta#lista-de-espera')

  // «Empezar a cocinar» opens cook mode, still without an account.
  await Promise.all([
    page.waitForURL(new RegExp(`/recipes/${recipe.id}/cook`), { timeout: 20_000 }),
    page.getByTestId('recipe-action-bar').getByRole('link', { name: /^empezar a cocinar$/i }).click(),
  ])
  await expect(page.getByRole('button', { name: /salir del modo cocina/i })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('cook-handsfree')).toHaveCount(0)
})

test('signed out at 1440×900: public chrome, footer flush left, CTA in the right column', async ({ page, request }) => {
  const recipe = await catalogueRecipe(request)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/recipes/${recipe.id}`)
  await expect(page.getByRole('heading', { level: 1, name: recipe.name })).toBeVisible({ timeout: 20_000 })
  await expectPublicChrome(page)
  await expect(page.getByRole('link', { name: /^empezar a cocinar$/i })).toBeVisible()
  await expect(page.getByTestId('recipe-waitlist-cta')).toBeAttached()
  const footer = await page.getByTestId('site-footer').boundingBox()
  expect(footer?.x ?? -1).toBeLessThan(2)
  // The photo column starts on the public grid, under the navbar logo.
  const logo = await page.getByTestId('public-logo').boundingBox()
  const photo = await page.getByRole('img', { name: recipe.name }).first().boundingBox()
  expect(Math.abs((photo?.x ?? 0) - (logo?.x ?? 100))).toBeLessThanOrEqual(2)
  // Back link signed out → the catalogue, public at /recipes.
  await expect(page.getByRole('link', { name: /^recetas$/i }).first()).toHaveAttribute('href', '/recipes')
})

test('signed out: a private or unknown recipe says it is private, with sign-in and the catalogue', async ({ page }) => {
  await page.goto('/recipes/00000000-0000-4000-8000-000000000000')
  await expect(page.getByRole('heading', { name: /esta receta es privada/i })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('recipe-private').getByRole('link', { name: /^entrar$/i })).toHaveAttribute(
    'href',
    `/login?next=${encodeURIComponent('/recipes/00000000-0000-4000-8000-000000000000')}`,
  )
  await expect(page.getByTestId('recipe-private').getByRole('link', { name: /ver el catálogo/i })).toHaveAttribute('href', '/recipes')
  await expectPublicChrome(page)
})

test('/recipes-ona/<id> redirects permanently to /recipes/<id> keeping the query', async ({ request }) => {
  const res = await request.get('/recipes-ona/abc-123?x=1&ref=receta', { maxRedirects: 0 })
  expect(res.status()).toBe(308)
  expect(res.headers()['location']).toBe('/recipes/abc-123?x=1&ref=receta')
})

test('link previews: the recipe page sets its own title, Open Graph and canonical', async ({ request }) => {
  const { id } = await catalogueRecipe(request)
  const recipe = (await (await request.get(`${API_URL}/recipes/${id}`)).json()) as { id: string; name: string; imageUrl?: string | null }
  // A link-preview crawler (WhatsApp/Facebook) gets the metadata in <head>.
  const html = await (
    await request.get(`/recipes/${recipe.id}`, { headers: { 'user-agent': 'facebookexternalhit/1.1' } })
  ).text()
  const esc = recipe.name.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  expect(html).toContain(`<meta property="og:title" content="${esc}"/>`)
  expect(html).toContain(`<link rel="canonical" href="https://mimoia.com/recipes/${recipe.id}"/>`)
  expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>')
  // The photo, as an absolute URL (unit-tested in recipePublicPage.test.ts;
  // the e2e seed may have no photos).
  if (recipe.imageUrl) expect(html).toMatch(/<meta property="og:image" content="https?:\/\//)
  // Only one <title>: the root layout's default steps aside here.
  expect(html.match(/<title>/g)?.length).toBe(1)
  expect(html).not.toContain('Tu semana de comidas, ya pensada</title>')
})

test('signed in: /recipes/<id> keeps the app shell', async ({ page, request }) => {
  test.setTimeout(60_000)
  const recipe = await catalogueRecipe(request)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/recipes/${recipe.id}`)
  await expect(page.getByRole('heading', { level: 1, name: recipe.name })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('app-wordmark')).toBeVisible()
  await expect(page.getByTestId('public-logo')).toHaveCount(0)
  await expect(page.getByTestId('site-footer')).toHaveCount(0)
  await expect(page.getByTestId('recipe-waitlist-cta')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /añadir al menú/i })).toBeVisible()
})
