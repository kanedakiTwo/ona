/**
 * PRO-03: a pencil on the recipe photo opens the editor — on the user's own
 * recipes (same `canEdit` rule as "Editar receta" under Notas: author or
 * admin), never on catalogue recipes for a normal user. Mobile and desktop.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

for (const viewport of [
  { name: 'móvil', width: 390, height: 844 },
  { name: 'escritorio', width: 1280, height: 900 },
]) {
  test(`hero pencil (${viewport.name}): own recipe yes, catalogue no`, async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await registerFreshUser(page)
    if (page.url().includes('/onboarding')) await completeOnboarding(page)

    const token = await page.evaluate(() => localStorage.getItem('ona_token'))
    const auth = { Authorization: `Bearer ${token}` }
    const found = await (await page.request.get(`${API_URL}/ingredients?search=ternera&perPage=50`)).json()
    const ternera = (found as Array<{ id: string; name: string }>).find((i) => i.name === 'ternera')
    expect(ternera, 'seed has "ternera"').toBeTruthy()

    const created = await page.request.post(`${API_URL}/recipes`, {
      headers: auth,
      data: {
        name: 'Ternera guisada del lápiz',
        servings: 2,
        meals: ['lunch'],
        seasons: ['winter'],
        equipment: ['cazuela'],
        ingredients: [{ ingredientId: ternera!.id, quantity: 400, unit: 'g' }],
        steps: [{ index: 0, text: 'Guisa la ternera a fuego lento.' }],
        force: true,
      },
    })
    expect(created.status()).toBe(201)
    const own = await created.json()

    // Own recipe: pencil on the photo, leads to the editor.
    await page.goto(`/recipes/${own.id}`)
    const pencil = page.getByTestId('recipe-hero-edit')
    await expect(pencil).toBeVisible({ timeout: 15_000 })
    await pencil.click()
    await expect(page).toHaveURL(new RegExp(`/recipes/${own.id}/edit`), { timeout: 15_000 })

    // Catalogue recipe (no author): no pencil for a normal user.
    const catalogue: Array<{ id: string; authorId?: string | null }> = await (
      await page.request.get(`${API_URL}/recipes?perPage=20`)
    ).json()
    const system = catalogue.find((r) => !r.authorId)
    expect(system, 'seed has a catalogue recipe').toBeTruthy()
    await page.goto(`/recipes/${system!.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('recipe-hero-edit')).toHaveCount(0)
  })
}
