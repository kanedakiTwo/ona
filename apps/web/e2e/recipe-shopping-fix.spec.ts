/**
 * PRO-90: the "Para hacer la compra" notice must go away once the author
 * fixes the recipe in the editor. It didn't: typing an amount on a row
 * "al gusto" kept the unit, the row was saved as "1 al gusto" and the notice
 * came back on the detail page. Two ways in, as Miguel hit them (2026-10-14,
 * "jengibre fresco" and "cilantro" with no amount):
 *   1. an imported recipe lands on its editor with the notice → fix → save;
 *   2. the detail's "Corregir en la receta" → fix → save.
 * (1) creates the recipe the way an import leaves it (rows "al gusto",
 * source link) and opens the editor the import redirects to — the real
 * extraction calls a paid model and can't run in CI.
 */

import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

async function setup(page: Page) {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const auth = { Authorization: `Bearer ${token}` }
  const ensure = async (name: string) => {
    const r = await page.request.post(`${API_URL}/ingredients/auto-create`, { headers: auth, data: { name } })
    expect(r.ok(), `auto-create ${name}`).toBe(true)
    return (await r.json()).ingredient as { id: string; name: string }
  }
  const [jengibre, cilantro, calabacin] = await Promise.all([ensure('jengibre fresco'), ensure('cilantro'), ensure('calabacin')])
  const created = await page.request.post(`${API_URL}/recipes`, {
    headers: auth,
    data: {
      name: 'Salteado de calabacín con jengibre',
      servings: 2,
      meals: ['dinner'],
      seasons: ['summer'],
      equipment: ['sarten'],
      sourceUrl: 'https://example.com/salteado',
      sourceType: 'article',
      ingredients: [
        { ingredientId: calabacin.id, quantity: 2, unit: 'u' },
        { ingredientId: jengibre.id, quantity: 0, unit: 'al_gusto' },
        { ingredientId: cilantro.id, quantity: 0, unit: 'al_gusto' },
      ],
      steps: [{ index: 0, text: 'Saltea el calabacín con el jengibre y termina con el cilantro.' }],
      force: true,
    },
  })
  expect(created.status()).toBe(201)
  const recipe = await created.json()
  return { recipe, jengibre, cilantro }
}

async function save(page: Page, id: string) {
  await page.getByRole('button', { name: /Guardar cambios/ }).click()
  const anyway = page.getByRole('button', { name: /Guardar igualmente/ })
  await Promise.race([
    page.waitForURL(new RegExp(`/recipes/${id}$`), { timeout: 15_000 }),
    anyway.waitFor({ timeout: 15_000 }).then(() => anyway.click()),
  ])
  await expect(page).toHaveURL(new RegExp(`/recipes/${id}$`), { timeout: 15_000 })
}

async function expectNoNotice(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('tab', { name: 'Ingredientes' }).or(page.getByRole('heading', { name: 'Ingredientes' })).first()).toBeVisible()
  await expect(page.getByTestId('shopping-issues')).toHaveCount(0)
  // …and after a reload too: the notice is recomputed from what was saved.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/calabac/i).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('shopping-issues')).toHaveCount(0)
}

test('imported recipe: fix the rows "al gusto" in the editor → the notice goes away', async ({ page }) => {
  test.setTimeout(90_000)
  const { recipe } = await setup(page)

  await page.goto(`/recipes/${recipe.id}/edit`)
  const notice = page.getByTestId('shopping-issues')
  await expect(notice).toBeVisible({ timeout: 15_000 })
  // Only units the selector has.
  await expect(notice).toContainText('1 ud (manojo) de cilantro')
  await expect(notice).not.toContainText('1 manojo')

  await page.getByLabel('Cantidad de jengibre fresco').fill('1')
  await page.getByLabel('Cantidad de cilantro').fill('1')
  // The unit followed the amount: no longer "al gusto".
  await expect(page.getByLabel('Unidad de jengibre fresco')).toHaveValue('u')
  await expect(page.getByLabel('Unidad de cilantro')).toHaveValue('u')
  await save(page, recipe.id)
  await expectNoNotice(page)
})

test('«Corregir en la receta» → fix → save → back on the detail without the notice', async ({ page }) => {
  test.setTimeout(90_000)
  const { recipe } = await setup(page)

  await page.goto(`/recipes/${recipe.id}`)
  const notice = page.getByTestId('shopping-issues')
  await expect(notice).toBeVisible({ timeout: 15_000 })
  await expect(notice).toContainText('jengibre fresco')
  await expect(notice).toContainText('cilantro')
  await notice.getByRole('link', { name: 'Corregir en la receta' }).click()
  await expect(page).toHaveURL(new RegExp(`/recipes/${recipe.id}/edit`), { timeout: 15_000 })

  await page.getByLabel('Cantidad de jengibre fresco').fill('20')
  await page.getByLabel('Unidad de jengibre fresco').selectOption('g')
  await page.getByLabel('Cantidad de cilantro').fill('1')
  await save(page, recipe.id)
  await expectNoNotice(page)
})
