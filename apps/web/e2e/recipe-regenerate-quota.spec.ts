/**
 * PRO-86: on the user's own recipe, the «Regenerar imagen» monthly counter
 * sits above its button (eyebrow style) and «Editar receta» and «Regenerar
 * imagen» start at the same height — the counter used to sit below and push
 * the row out of line. Mobile and desktop.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

for (const viewport of [
  { name: 'móvil', width: 390, height: 844 },
  { name: 'escritorio', width: 1440, height: 900 },
]) {
  test(`regenerate-image counter above its button (${viewport.name})`, async ({ page }) => {
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
        name: 'Ternera del contador',
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

    await page.goto(`/recipes/${own.id}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 })
    // On mobile the author controls live in the «Notas» tab.
    const notas = page.getByRole('tab', { name: 'Notas' })
    if (await notas.isVisible()) await notas.click()
    const section = page.getByRole('region', { name: 'Tu receta' })
    const edit = section.getByRole('link', { name: /Editar receta/ })
    const regen = section.getByRole('button', { name: /Regenerar imagen/ })
    const counter = section.getByText(/\d+\/\d+ este mes/)
    await expect(edit).toBeVisible({ timeout: 15_000 })
    await expect(regen).toBeVisible()
    await expect(counter).toBeVisible({ timeout: 10_000 })
    await section.scrollIntoViewIfNeeded()

    const e = (await edit.boundingBox())!
    const r = (await regen.boundingBox())!
    const c = (await counter.boundingBox())!
    // Same row, same top (1 px of rounding allowed).
    expect(Math.abs(e.y - r.y)).toBeLessThanOrEqual(1)
    // The counter ends above the button and overlaps it horizontally.
    expect(c.y + c.height).toBeLessThanOrEqual(r.y)
    expect(c.x).toBeLessThan(r.x + r.width)
    expect(c.x + c.width).toBeGreaterThan(r.x)
    // Neither button spills out of the viewport.
    expect(r.x + r.width).toBeLessThanOrEqual(viewport.width)
    // …and the labels fit inside their pills (no clipped text).
    for (const pill of [edit, regen]) {
      const fits = await pill.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
      expect(fits).toBe(true)
    }

    await page.screenshot({ path: test.info().outputPath(`regenerar-imagen-${viewport.width}.png`) })
  })
}
