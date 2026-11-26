/**
 * PRO-1115 — on the phone, a recipe is written as on paper: the ingredients
 * one per line, the preparation pasted whole. Each line says how it was
 * understood («✓», «¿cuál?», «nuevo, se crea al guardar»); the steps split by
 * their numbering. Saving creates the new ingredient in the library, and
 * opening the editor and saving without touching anything leaves the recipe
 * as it was.
 */
import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

interface SavedRecipe {
  name: string
  ingredients: Array<{
    ingredientId: string
    ingredientName?: string
    quantity: number
    unit: string
    optional?: boolean
    note?: string | null
    displayQuantity?: number | null
    displayUnit?: string | null
  }>
  steps: Array<{ index: number; text: string }>
}

/** What a save must not change. */
function essentials(r: SavedRecipe) {
  return {
    name: r.name,
    ingredients: r.ingredients.map((i) => ({
      ingredientId: i.ingredientId,
      quantity: i.quantity,
      unit: i.unit,
      optional: i.optional ?? false,
      note: i.note ?? null,
      displayQuantity: i.displayQuantity ?? null,
      displayUnit: i.displayUnit ?? null,
    })),
    steps: r.steps.map((s) => s.text),
  }
}

test('pegar 5 ingredientes y 4 pasos en /recipes/new los guarda; el editor sin tocar no cambia nada', async ({ page }) => {
  test.setTimeout(120_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const auth = { Authorization: `Bearer ${token}` }

  const newName = `kombu${Date.now().toString(36)}`
  await page.goto('/recipes/new')
  await page.locator('#recipe-name').fill('Lentejas con kombu de prueba')
  await page.getByRole('button', { name: /comida/i }).first().click()
  await page.getByRole('button', { name: /primavera/i }).first().click()

  const ingredients = page.locator('#recipe-ingredients')
  await ingredients.fill(
    [
      '200 g de lentejas',
      '1 cebolla',
      '2 cucharadas de aceite',
      '2 dientes de ajo, picados',
      `20 g de ${newName} (opcional)`,
    ].join('\n'),
  )
  const lines = page.getByTestId('ingredient-line')
  await expect(lines).toHaveCount(5)
  await expect(lines.nth(0)).toHaveAttribute('data-status', 'match', { timeout: 10_000 })
  await expect(lines.nth(0)).toContainText('200 g')
  await expect(lines.nth(0)).toContainText('lentejas')
  await expect(lines.nth(1)).toHaveAttribute('data-status', 'match')
  await expect(lines.nth(3)).toHaveAttribute('data-status', 'match')
  await expect(lines.nth(3)).toContainText('picados')
  // «aceite» is more generic than the library's «aceite de oliva virgen»: it asks.
  await expect(lines.nth(2)).toHaveAttribute('data-status', 'doubt')
  await expect(lines.nth(2).getByTestId('ingredient-line-status')).toHaveText('¿cuál?')
  await lines.nth(2).getByRole('button', { name: 'aceite de oliva virgen' }).click()
  await expect(lines.nth(2)).toHaveAttribute('data-status', 'match')
  await expect(lines.nth(4)).toHaveAttribute('data-status', 'new')
  await expect(lines.nth(4)).toContainText('nuevo, se crea al guardar')
  await expect(lines.nth(4)).toContainText('opcional')

  await page.locator('#recipe-steps').fill(
    [
      'Preparación:',
      '1. Pon las lentejas en remojo la noche anterior.',
      '2. Pica la cebolla y el ajo y sofríelos en el aceite',
      'a fuego medio.',
      `3. Añade las lentejas, el ${newName} y agua hasta cubrir.`,
      '4. Cuece 40 minutos.',
    ].join('\n'),
  )
  await expect(page.getByTestId('step-line')).toHaveCount(4)
  await expect(page.getByTestId('step-line').nth(1)).toContainText('sofríelos en el aceite a fuego medio.')

  // Save; lint warnings (if any) are advisory: «Guardar igualmente».
  const anyway = page.getByRole('button', { name: /Guardar igualmente/ })
  await page.getByRole('button', { name: /^crear receta$/i }).click()
  await Promise.race([
    page.waitForURL(/\/recipes\/[0-9a-f-]{36}\/edit/, { timeout: 30_000 }),
    anyway.waitFor({ timeout: 30_000 }).then(() => anyway.click()),
  ])
  await page.waitForURL(/\/recipes\/[0-9a-f-]{36}\/edit/, { timeout: 30_000 })
  const id = page.url().match(/\/recipes\/([0-9a-f-]{36})\/edit/)![1]

  const saved: SavedRecipe = await (await page.request.get(`${API_URL}/recipes/${id}`, { headers: auth })).json()
  expect(saved.ingredients).toHaveLength(5)
  expect(saved.steps.map((s) => s.text)).toEqual([
    'Pon las lentejas en remojo la noche anterior.',
    'Pica la cebolla y el ajo y sofríelos en el aceite a fuego medio.',
    `Añade las lentejas, el ${newName} y agua hasta cubrir.`,
    'Cuece 40 minutos.',
  ])
  const byName = Object.fromEntries(saved.ingredients.map((i) => [i.ingredientName, i]))
  expect(byName['lentejas']).toMatchObject({ quantity: 200, unit: 'g' })
  expect(byName['cebolla']).toMatchObject({ quantity: 1, unit: 'u' })
  expect(byName['aceite de oliva virgen']).toMatchObject({ quantity: 2, unit: 'cda' })
  expect(byName['ajo']).toMatchObject({ quantity: 10, unit: 'g', note: 'picados', displayQuantity: 2, displayUnit: 'dientes' })
  expect(byName[newName]).toMatchObject({ quantity: 20, unit: 'g', optional: true })

  // The new one is in the library now.
  const found: Array<{ id: string; name: string }> = await (
    await page.request.get(`${API_URL}/ingredients?search=${encodeURIComponent(newName)}`)
  ).json()
  expect(found).toEqual([expect.objectContaining({ id: byName[newName].ingredientId, name: newName })])

  // The editor shows the saved rows as text; saving untouched changes nothing.
  await page.goto(`/recipes/${id}/edit`)
  await expect(page.locator('#recipe-ingredients')).toHaveValue(
    [
      '200 g de lentejas',
      '1 cebolla',
      '2 cucharadas de aceite de oliva virgen',
      '2 dientes de ajo, picados',
      `20 g de ${newName} (opcional)`,
    ].join('\n'),
    { timeout: 15_000 },
  )
  await expect(page.locator('[data-testid="ingredient-line"][data-status="match"]')).toHaveCount(5)
  await expect(page.getByTestId('step-line')).toHaveCount(4)
  const save = page.getByRole('button', { name: /^guardar cambios$/i })
  await save.click()
  await Promise.race([
    page.waitForURL(new RegExp(`/recipes/${id}$`), { timeout: 20_000 }),
    anyway.waitFor({ timeout: 20_000 }).then(() => anyway.click()),
  ])
  await expect(page).toHaveURL(new RegExp(`/recipes/${id}$`), { timeout: 20_000 })

  const after: SavedRecipe = await (await page.request.get(`${API_URL}/recipes/${id}`, { headers: auth })).json()
  expect(essentials(after)).toEqual(essentials(saved))
})
