/**
 * PRO-01: with voice mode on, the floating mic used to sit right on top of the
 * favourite button in the recipe detail's mobile hero (both fixed/absolute at
 * the top-right). The favourite must stay tappable — no floating button over
 * it — at 390×844 and on desktop.
 */

import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const apiUrl = process.env.API_URL ?? 'http://localhost:8765'

async function firstRecipeId(page: Page): Promise<string> {
  const list: Array<{ id: string }> = await (await page.request.get(`${apiUrl}/recipes?perPage=1`)).json()
  expect(list.length).toBeGreaterThan(0)
  return list[0].id
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

for (const viewport of [
  { name: 'móvil', width: 390, height: 844 },
  { name: 'escritorio', width: 1280, height: 900 },
]) {
  test(`recipe detail (${viewport.name}): voice FAB does not cover the favourite`, async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await registerFreshUser(page)
    if (page.url().includes('/onboarding')) await completeOnboarding(page)

    // Voice mode on, as the /profile toggle leaves it.
    await page.evaluate(() => localStorage.setItem('ona.voice.enabled', '1'))
    await page.goto(`/recipes/${await firstRecipeId(page)}`)

    const fab = page.getByRole('button', { name: /^(abrir modo voz|modo voz activo)/i })
    const fav = page.getByRole('button', { name: 'Añadir a favoritos' })
    await expect(fab).toBeVisible({ timeout: 15_000 })
    await expect(fav).toBeVisible()

    const fabBox = (await fab.boundingBox())!
    const favBox = (await fav.boundingBox())!
    expect(overlaps(fabBox, favBox)).toBe(false)

    // A real click (no force): Playwright refuses if another element would get
    // it. The detail doesn't echo favourite state back yet (recipes.md known
    // limitation), so "it changed" = the toggle reached the API.
    const toggled = page.waitForResponse(
      (r) => /\/recipes\/[^/]+\/favorite$/.test(r.url()) && r.request().method() === 'POST',
    )
    await fav.click()
    expect((await toggled).ok()).toBe(true)
  })
}
