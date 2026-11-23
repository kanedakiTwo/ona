/**
 * PRO-1107 · the «Cocinar» tab (specs/cook-now.md): what the menu had for the
 * meal of now, the four questions (answers kept going back), the proposal
 * 1 + 2 (an alternative becomes the preferred one) and «Cocinar esta» with
 * the sheet that moves the planned dish. /cook-now/* is mocked so the
 * proposal doesn't depend on the seeded catalogue or the clock.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const R1 = '00000000-0000-4000-8000-0000000000a1'
const R2 = '00000000-0000-4000-8000-0000000000a2'
const R3 = '00000000-0000-4000-8000-0000000000a3'

const TODAY = {
  weekStart: '2026-11-09',
  day: 2,
  meal: 'dinner',
  menuId: 'menu-e2e',
  planned: [{ recipeId: '00000000-0000-4000-8000-0000000000b1', recipeName: 'Merluza al horno', imageUrl: null, totalTime: 35 }],
  slotServings: null,
  targets: [
    { day: 3, replaces: null, disabled: false },
    { day: 4, replaces: 'Lentejas estofadas', disabled: true },
  ],
}

const item = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  recipe: { id, name, imageUrl: null, totalTime: 25 },
  fit: 'fits',
  missingEssential: [],
  short: [],
  missingSecondary: [],
  substitutions: [],
  uses: ['huevo'],
  expiring: [],
  ...extra,
})

async function mockCookNow(page: Page, chosen: unknown[]) {
  await page.route('**/cook-now/today', (route) => route.fulfill({ json: TODAY }))
  await page.route('**/cook-now/proposal', (route) => {
    const body = route.request().postDataJSON() as { requirePantryUse?: boolean }
    if (body.requirePantryUse) return route.fulfill({ json: { meal: 'dinner', fallback: false, items: [item(R2, 'Tortilla de patatas')] } })
    return route.fulfill({
      json: {
        meal: 'dinner',
        fallback: false,
        items: [
          item(R1, 'Revuelto de setas'),
          item(R2, 'Tortilla de patatas', { missingSecondary: ['cebolla'] }),
          item(R3, 'Crema de calabaza', { fit: 'margin' }),
        ],
      },
    })
  })
  await page.route('**/cook-now/phrase', (route) => route.fulfill({ json: { text: 'Aprovecha los huevos que tienes.' } }))
  await page.route('**/cook-now/choose', (route) => {
    chosen.push(route.request().postDataJSON())
    return route.fulfill({ json: { placed: true, menuId: 'menu-e2e', weekStart: '2026-11-09', day: 2, meal: 'dinner' } })
  })
}

test('«Cocinar»: the four questions, the proposal and «Cocinar esta» moving the planned dish', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const chosen: unknown[] = []
  await mockCookNow(page, chosen)

  await page.getByRole('navigation').getByRole('link', { name: 'Cocinar' }).first().click()
  await expect(page).toHaveURL(/\/cocinar$/, { timeout: 20_000 })
  await expect(page.getByTestId('cook-now-today')).toContainText('Hoy toca Merluza al horno')
  await expect(page.getByRole('link', { name: 'Empezar a cocinar' })).toHaveAttribute(
    'href',
    `/recipes/${TODAY.planned[0].recipeId}/cook?servings=1&menu=menu-e2e&day=2&meal=dinner`,
  )
  // «Con lo que tienes» moved here from /menu.
  await expect(page.getByTestId('cook-now-pantry-match')).toContainText('Tortilla de patatas')
  await expect(page.locator('#despensa')).toContainText('Tu despensa')

  await page.getByRole('button', { name: '¿Otra cosa? Cocinar ahora' }).click()
  await expect(page.getByRole('heading', { name: '¿Cuánto tiempo tienes?' })).toBeVisible()
  await page.getByRole('button', { name: '30 min' }).click()
  await expect(page.getByRole('heading', { name: '¿Para cuántos?' })).toBeVisible()
  await page.getByRole('button', { name: 'Uno más' }).click()
  await expect(page.getByLabel('Personas')).toHaveText('2')
  // Back keeps the answer.
  await page.getByRole('button', { name: 'Atrás' }).click()
  await expect(page.getByRole('button', { name: '30 min' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '30 min' }).click()
  await expect(page.getByLabel('Personas')).toHaveText('2')
  await page.getByRole('button', { name: 'Seguir' }).click()
  await page.getByRole('button', { name: 'Sí, algo' }).click()
  await expect(page.getByRole('heading', { name: '¿Qué tienes en casa?' })).toBeVisible()
  await page.getByRole('button', { name: 'Proponme una receta' }).click()

  const proposal = page.getByTestId('cook-now-proposal')
  await expect(proposal.getByRole('heading', { name: 'Revuelto de setas' })).toBeVisible({ timeout: 10_000 })
  await expect(proposal).toContainText('No te falta nada')
  await expect(proposal).toContainText('Aprovecha los huevos que tienes.')
  // An alternative becomes the preferred one.
  await proposal.getByRole('button', { name: /Tortilla de patatas/ }).click()
  await expect(proposal.getByRole('heading', { name: 'Tortilla de patatas' })).toBeVisible()
  await expect(proposal).toContainText('Puedes hacerla sin cebolla')

  await page.getByRole('button', { name: 'Cocinar esta' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText('¿Y el Merluza al horno?')
  await sheet.getByRole('button', { name: 'Pasarlo a otro día' }).click()
  await expect(sheet.getByRole('button', { name: /El viernes/ })).toBeDisabled()
  await sheet.getByRole('button', { name: /Mañana/ }).click()

  await expect(page).toHaveURL(new RegExp(`/recipes/${R2}/cook\\?servings=2&menu=menu-e2e&day=2&meal=dinner`), { timeout: 15_000 })
  // Two people against a household of one: the slot keeps its own count.
  expect(chosen).toEqual([{ recipeId: R2, servings: 2, displacedTo: 3 }])
})

test('«Cocinar» is a tab of the desktop sidebar too', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await registerFreshUser(page)
  await completeOnboarding(page)
  await mockCookNow(page, [])
  await page.goto('/menu')
  await page.getByRole('link', { name: 'Cocinar', exact: true }).first().click()
  await expect(page).toHaveURL(/\/cocinar$/, { timeout: 20_000 })
  await expect(page.getByRole('heading', { level: 1 })).toContainText('cocinamos')
  await expect(page.getByTestId('cook-now-today')).toBeVisible()
  // The old «Con lo que tienes» card is gone from the menu.
  await page.goto('/menu')
  await expect(page.getByText('Puedes cocinar')).toHaveCount(0)
})
