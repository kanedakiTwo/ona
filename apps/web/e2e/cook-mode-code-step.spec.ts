/**
 * PRO-1292: in cook mode, «Siguiente» to Mimo is answered by the code — no
 * model: Mimo reads the next step of the recipe on screen and the screen
 * moves to it. Nothing is mocked: the CI has no model key, so a reply here
 * can only come from the code.
 */

import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const apiUrl = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

test('cook mode: «Siguiente» reads the next step and moves the screen to it', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  // A catalogue recipe with at least two steps.
  const list: Array<{ id: string }> = await (await page.request.get(`${apiUrl}/recipes?perPage=20`)).json()
  let recipe: { id: string; steps: Array<{ text: string }> } | null = null
  for (const r of list) {
    const detail = await (await page.request.get(`${apiUrl}/recipes/${r.id}`)).json()
    if (Array.isArray(detail?.steps) && detail.steps.length >= 2) {
      recipe = detail
      break
    }
  }
  expect(recipe, 'the seeded catalogue has a recipe with steps').toBeTruthy()
  const total = recipe!.steps.length
  const step2 = recipe!.steps[1].text.replace(/\s+/g, ' ').trim()

  await page.goto(`/recipes/${recipe!.id}/cook`)
  await expect(page.getByLabel(`Paso 1 de ${total}`)).toBeVisible({ timeout: 15_000 })

  const replies: Array<{ uiHint?: string }> = []
  page.on('response', async (r) => {
    if (/\/assistant\/[^/]+\/chat$/.test(r.url()) && r.request().method() === 'POST') replies.push(await r.json().catch(() => ({})))
  })

  await page.getByTestId('mimo-button').click()
  const panel = page.getByTestId('mimo-panel')
  await page.getByTestId('mimo-input').fill('Siguiente')
  await page.getByRole('button', { name: 'Enviar' }).click()

  await expect(panel.getByText(`Paso 2${total === 2 ? ', el último' : ` de ${total}`}: ${step2}`)).toBeVisible({ timeout: 15_000 })
  expect(replies.at(-1)?.uiHint).toBe('cooking_step')
  // The cook screen behind the panel moved to step 2.
  await expect(page.getByLabel(`Paso 2 de ${total}`)).toBeAttached()
  await expect(page.getByLabel(`Paso 1 de ${total}`)).toHaveCount(0)
})
