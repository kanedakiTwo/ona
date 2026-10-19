/**
 * PRO-184 (Laura, hogares de prueba, 2026-10-16): «Espaguetis con ajo y
 * aceite» «Para 1 ración» said «Ajo · 6 dientes, laminados»: the grams were
 * scaled, the note wasn't. A note that starts with a countable amount now
 * scales with the servings, rounded to halves.
 */
import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.use({ viewport: { width: 390, height: 844 } })

test('«6 dientes, laminados» for 4 reads «1½ dientes, laminados» for 1', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  await page.goto('/recipes/new')
  await page.locator('input[placeholder*="Tortilla" i]').fill('E2E ajo por raciones')
  await page.locator('#recipe-servings').fill('4')
  await page.locator('input[placeholder="30"]').fill('15')
  await page.getByRole('button', { name: /comida/i }).first().click()
  await page.getByRole('button', { name: /primavera/i }).first().click()

  await page.getByPlaceholder(/ingrediente|cargando/i).first().fill('ajo')
  const ajoOption = page.locator('ul[role="listbox"] li button', { hasText: /^ajo$/i }).first()
  try {
    await ajoOption.waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    test.skip(true, 'Catalog has no exact "ajo" match — seed missing or renamed.')
    return
  }
  await ajoOption.click()
  await page.locator('input[placeholder="Cant."]').first().fill('24')
  await page.getByRole('textbox', { name: /nota de ajo/i }).fill('6 dientes, laminados')
  await page.locator('textarea').first().fill('Laminar el ajo y dorarlo')

  await Promise.all([
    page.waitForURL(/\/recipes\/[0-9a-f-]{36}\/edit/, { timeout: 20_000 }),
    page.getByRole('button', { name: /^crear receta$/i }).click(),
  ])
  const id = page.url().match(/recipes\/([0-9a-f-]{36})/)![1]

  await page.goto(`/recipes/${id}?servings=1`)
  await expect(page.getByText('1½ dientes, laminados')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('6 dientes, laminados')).toHaveCount(0)

  // At its own 4 servings the note is as written.
  await page.goto(`/recipes/${id}?servings=4`)
  await expect(page.getByText('6 dientes, laminados')).toBeVisible({ timeout: 15_000 })
})
