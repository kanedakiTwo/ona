/**
 * PRO-85: when Mimo shows today's menu in the web panel, each recipe name is a
 * link to its page; a note («cenamos fuera») is not. The assistant reply is
 * mocked (shape of `get_todays_menu`: uiHint `menu`, `data.day`), the recipe is
 * a real catalogue one so its page opens.
 */

import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const apiUrl = process.env.API_URL ?? 'http://localhost:8765'

test('«¿qué hay hoy?» in Mimo: tapping a dish opens its recipe', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  const list: Array<{ id: string; name: string }> = await (await page.request.get(`${apiUrl}/recipes?perPage=1`)).json()
  const recipe = list[0]
  expect(recipe, 'the seeded catalogue has recipes').toBeTruthy()

  await page.route('**/assistant/*/chat', (route) =>
    route.fulfill({
      json: {
        message: `Hoy comes ${recipe.name} y por la noche cenamos fuera.`,
        uiHint: 'menu',
        skillUsed: 'get_todays_menu',
        data: {
          dayIndex: 0,
          day: {
            lunch: { dishes: [{ kind: 'recipe', recipeId: recipe.id, recipeName: recipe.name }] },
            dinner: { dishes: [{ kind: 'note', text: 'cenamos fuera' }] },
          },
        },
      },
    }),
  )

  await page.goto('/menu')
  await page.getByTestId('mimo-button').click()
  const panel = page.getByTestId('mimo-panel')
  await page.getByTestId('mimo-input').fill('¿Qué hay hoy?')
  await page.getByRole('button', { name: 'Enviar' }).click()

  const links = panel.getByTestId('mimo-recipe-link')
  await expect(links).toHaveCount(1)
  await expect(links.first()).toHaveText(recipe.name)
  await expect(links.first()).toHaveAttribute('href', `/recipes/${recipe.id}`)
  await expect(panel.getByRole('link', { name: 'cenamos fuera' })).toHaveCount(0)

  await links.first().click()
  await expect(page).toHaveURL(new RegExp(`/recipes/${recipe.id}$`), { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: recipe.name }).first()).toBeVisible({ timeout: 15_000 })
})
