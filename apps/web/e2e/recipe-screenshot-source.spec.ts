/**
 * PRO-66 (web): on /recipes/new, a photo that looks like a screenshot of a
 * web page or a social network highlights «Enlace del original»; a cookbook
 * photo doesn't. The extractor is simulated (no real AI call).
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

test.use({ viewport: { width: 390, height: 844 } })

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function draft(looksLikeScreenshot: boolean) {
  return {
    name: 'Pasta cremosa',
    servings: 2,
    servingsConfidence: 'explicit',
    prepTime: 20,
    cookTime: null,
    meals: ['dinner'],
    seasons: ['autumn'],
    difficulty: null,
    tags: [],
    steps: ['Cocer la pasta', 'Mezclar con la salsa'],
    ingredients: [],
    unmatchedCount: 0,
    warnings: [],
    looksLikeScreenshot,
  }
}

async function importPhoto(page: Page, looksLikeScreenshot: boolean) {
  await page.route('**/recipes/extract-from-image', (route) => route.fulfill({ json: draft(looksLikeScreenshot) }))
  await page.goto('/recipes/new')
  // The import card's input (the «Foto de la receta» card has its own, PRO-145).
  await page.locator('input[type="file"]:not([data-testid="new-recipe-photo-input"])').setInputFiles({ name: 'captura.png', mimeType: 'image/png', buffer: PNG })
  await page.getByRole('button', { name: /analizar receta/i }).click()
  await expect(page.locator('#recipe-name')).toHaveValue('Pasta cremosa', { timeout: 10_000 })
}

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('a screenshot highlights «Enlace del original»', async ({ page }) => {
  await importPhoto(page, true)
  const field = page.getByTestId('recipe-source-field')
  await expect(field).toHaveAttribute('data-highlighted', 'true')
  await expect(field).toContainText(/parece una captura/i)
  await expect(page.getByLabel('Enlace del original')).toBeVisible()
})

test('a cookbook photo leaves the field as an ordinary optional one', async ({ page }) => {
  await importPhoto(page, false)
  const field = page.getByTestId('recipe-source-field')
  await expect(field).toHaveAttribute('data-highlighted', 'false')
  await expect(field).not.toContainText(/parece una captura/i)
  await expect(page.getByLabel('Enlace del original')).toBeVisible()
})
