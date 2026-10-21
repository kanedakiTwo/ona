/**
 * A recipe without a photo never shows a stock photo of another dish. The
 * detail used to fall back to an Unsplash salad with egg and avocado, which on
 * «Escudella barrejada» read as that recipe's photo. Now the photo slot shows
 * the same neutral placeholder as the catalogue card (`recipe-photo-placeholder`),
 * on mobile and desktop; a recipe with a photo still shows it.
 */

import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'
const NAME = 'Escudella sin foto'
/** A committed seed photo, served by the web itself. */
const SEED_PHOTO = '/images/recipes/acelgas-rehogadas.jpg'

/** The user's own recipe, created through the API without any image. */
async function createRecipeWithoutPhoto(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const found = await (await page.request.get(`${API_URL}/ingredients?search=ternera&perPage=50`)).json()
  const ternera = (found as Array<{ id: string; name: string }>).find((i) => i.name === 'ternera')
  expect(ternera, 'seed has "ternera"').toBeTruthy()
  const created = await page.request.post(`${API_URL}/recipes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: NAME,
      servings: 2,
      meals: ['lunch'],
      seasons: ['winter'],
      equipment: ['cazuela'],
      ingredients: [{ ingredientId: ternera!.id, quantity: 400, unit: 'g' }],
      steps: [{ index: 0, text: 'Cuece la ternera a fuego lento.' }],
      force: true,
    },
  })
  expect(created.status()).toBe(201)
  return ((await created.json()) as { id: string }).id
}

/**
 * Makes the detail's read of the recipe answer `imageUrl`. Deterministic:
 * if the API had an image provider configured it could attach a generated
 * photo in the background, and the e2e seed has no photos at all.
 */
async function serveRecipeImage(page: Page, id: string, imageUrl: string | null): Promise<void> {
  const api = new URL(API_URL)
  const isThisRecipe = (url: URL) => url.origin === api.origin && url.pathname === `/recipes/${id}`
  await page.unroute(isThisRecipe).catch(() => {})
  await page.route(isThisRecipe, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const res = await route.fetch()
    await route.fulfill({ response: res, json: { ...(await res.json()), imageUrl } })
  })
}

for (const viewport of [
  { name: 'móvil', width: 390, height: 844 },
  { name: 'escritorio', width: 1280, height: 900 },
]) {
  test(`receta sin foto (${viewport.name}): relleno neutro, ninguna foto de otro plato`, async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await registerFreshUser(page)
    if (page.url().includes('/onboarding')) await completeOnboarding(page)

    const id = await createRecipeWithoutPhoto(page)
    await serveRecipeImage(page, id, null)
    await page.goto(`/recipes/${id}`)
    await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible({ timeout: 15_000 })

    const placeholder = page.getByTestId('recipe-photo-placeholder')
    await expect(placeholder).toBeVisible()
    await expect(page.getByRole('img', { name: `${NAME}, sin foto` })).toBeVisible()
    // Fills the photo slot (mobile: the 390 px hero; desktop: the sticky photo).
    const box = await placeholder.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(380)
    await expect(page.locator('img[src*="unsplash"]')).toHaveCount(0)
    await expect(page.locator(`img[alt="${NAME}"]`)).toHaveCount(0)

    // The same recipe with a photo shows that photo, and no placeholder.
    await serveRecipeImage(page, id, SEED_PHOTO)
    await page.reload()
    const photo = page.locator(`img[alt="${NAME}"]`)
    await expect(photo).toBeVisible({ timeout: 15_000 })
    await expect(photo).toHaveAttribute('src', SEED_PHOTO)
    await expect(page.getByTestId('recipe-photo-placeholder')).toHaveCount(0)
    await expect(page.locator('img[src*="unsplash"]')).toHaveCount(0)
    // A refetch still in flight at teardown must not fail the test.
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
}
