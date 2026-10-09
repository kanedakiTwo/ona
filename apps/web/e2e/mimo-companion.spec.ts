/**
 * Mimo, the companion (D-023, specs/advisor.md): a floating button on every
 * page opens the same assistant; it knows which page you are on, keeps the
 * conversation while you move around, and /advisor now just opens it.
 * The assistant reply is mocked: this is about the companion, not the LLM.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('ask Mimo from the menu, keep the conversation on another page, page context sent', async ({ page }) => {
  test.setTimeout(60_000)
  const bodies: any[] = []
  await page.route('**/assistant/*/chat', async (route) => {
    bodies.push(route.request().postDataJSON())
    await route.fulfill({ json: { message: 'Hoy toca lentejas con verduras.', uiHint: 'text' } })
  })

  await page.goto('/menu')
  // No «Asesor» tab any more: Mimo is the floating button.
  await expect(page.getByRole('navigation', { name: 'Navegación principal' }).getByText('Asesor', { exact: true })).toHaveCount(0)
  await page.getByTestId('mimo-button').click()
  const panel = page.getByTestId('mimo-panel')
  await expect(panel).toBeVisible()

  await page.getByTestId('mimo-input').fill('¿Qué toca hoy?')
  await page.getByRole('button', { name: 'Enviar' }).click()
  await expect(panel.getByText('Hoy toca lentejas con verduras.')).toBeVisible()
  expect(bodies[0]).toMatchObject({ message: '¿Qué toca hoy?', mode: 'text', context: { path: '/menu' } })

  // Close, go elsewhere, reopen: the conversation is still there.
  await page.getByRole('button', { name: 'Cerrar' }).click()
  await expect(panel).toHaveCount(0)
  await page.goto('/recipes')
  await page.getByTestId('mimo-button').click()
  await expect(page.getByTestId('mimo-panel').getByText('Hoy toca lentejas con verduras.')).toBeVisible()

  // The next turn carries the new page and the history.
  await page.getByTestId('mimo-input').fill('¿Y mañana?')
  await page.getByRole('button', { name: 'Enviar' }).click()
  await expect.poll(() => bodies.length).toBe(2)
  expect(bodies[1].context).toEqual({ path: '/recipes' })
  expect(bodies[1].history.map((m: any) => m.content)).toEqual(['¿Qué toca hoy?', 'Hoy toca lentejas con verduras.'])
})

test('/advisor opens Mimo on the menu', async ({ page }) => {
  await page.goto('/advisor')
  await expect(page).toHaveURL(/\/menu$/, { timeout: 10_000 })
  await expect(page.getByTestId('mimo-panel')).toBeVisible()
  await expect(page.getByTestId('ai-disclosure')).toBeVisible()
})
