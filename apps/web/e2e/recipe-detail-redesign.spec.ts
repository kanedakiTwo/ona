/**
 * Recipe detail "D · Luz y foto" (2026-10-08): on mobile the page is a hero
 * + tabs (Ingredientes · Pasos · Nutrición · Notas) with a sticky bottom
 * action bar that replaces the bottom tab bar. Fails on the old long-scroll
 * page (no tablist, no action bar, tab bar still shown, two inline cook CTAs).
 */

import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const apiUrl = process.env.API_URL ?? 'http://localhost:8765'

/** First catalogue recipe that has steps (so the Pasos tab has content). */
async function recipeWithSteps(page: Page): Promise<{ id: string; steps: unknown[] }> {
  const list: Array<{ id: string }> = await (await page.request.get(`${apiUrl}/recipes?perPage=10`)).json()
  for (const r of list) {
    const full = await (await page.request.get(`${apiUrl}/recipes/${r.id}`)).json()
    if ((full.steps?.length ?? 0) > 0) return full
  }
  throw new Error('no catalogue recipe with steps')
}

test('recipe detail: tabs, sticky cook bar, no tab bar, min-servings under Notas', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  await completeOnboarding(page)

  // Sanity: the bottom tab bar exists on the catalogue…
  const tabBar = page.locator('nav').filter({ has: page.getByRole('link', { name: 'Compra' }) })
  await page.goto('/recipes')
  await expect(tabBar.first()).toBeVisible({ timeout: 10_000 })

  const recipe = await recipeWithSteps(page)
  await page.goto(`/recipes/${recipe.id}`)

  // …and is gone on the detail, where the action bar takes its place.
  const tablist = page.getByRole('tablist', { name: /secciones de la receta/i })
  await expect(tablist).toBeVisible({ timeout: 15_000 })
  await expect(tabBar).toHaveCount(0)

  // Tabs: Ingredientes is selected by default; its panel shows the
  // servings stepper and the ingredient rows.
  const ingTab = tablist.getByRole('tab', { name: /^ingredientes$/i })
  const stepsTab = tablist.getByRole('tab', { name: new RegExp(`^pasos · ${recipe.steps.length}$`, 'i') })
  const notesTab = tablist.getByRole('tab', { name: /^notas$/i })
  await expect(ingTab).toHaveAttribute('aria-selected', 'true')
  const ingPanel = page.getByRole('tabpanel', { name: /ingredientes/i })
  await expect(ingPanel.getByRole('group', { name: 'Raciones' })).toBeVisible()
  await expect(ingPanel.getByRole('listitem').first()).toBeVisible()

  // The sticky bar's "Empezar a cocinar" is on screen without scrolling,
  // and it is the only cook CTA (the old page had two inline ones).
  const bar = page.getByTestId('recipe-action-bar')
  const cook = bar.getByRole('link', { name: /^empezar a cocinar$/i })
  await expect(cook).toBeInViewport()
  await expect(page.getByRole('link', { name: /empezar a cocinar/i })).toHaveCount(1)

  // The stepper drives the cook link's servings.
  const servingsText = (await ingPanel.getByTestId('servings-value').textContent()) ?? ''
  const before = parseInt(servingsText, 10)
  await ingPanel.getByRole('button', { name: 'Aumentar raciones' }).click()
  await expect(ingPanel.getByTestId('servings-value')).toHaveText(`${before + 1} raciones`)
  await expect(cook).toHaveAttribute('href', new RegExp(`/recipes/${recipe.id}/cook\\?servings=${before + 1}$`))

  // Switching tabs swaps panels (click + keyboard arrows).
  await stepsTab.click()
  await expect(stepsTab).toHaveAttribute('aria-selected', 'true')
  await expect(ingPanel).toBeHidden()
  const stepsPanel = page.getByRole('tabpanel', { name: /pasos/i })
  await expect(stepsPanel.getByRole('listitem')).toHaveCount(recipe.steps.length)
  await stepsTab.press('ArrowLeft')
  await expect(ingTab).toHaveAttribute('aria-selected', 'true')
  await expect(ingTab).toBeFocused()
  await ingTab.press('ArrowRight')
  await expect(stepsTab).toHaveAttribute('aria-selected', 'true')

  // Still on screen after scrolling to the end of the longest tab, and the
  // last step clears it (the page reserves room for the bar).
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect(cook).toBeInViewport()
  const lastStep = await stepsPanel.getByRole('listitem').last().boundingBox()
  const barBox = await bar.boundingBox()
  expect(lastStep!.y + lastStep!.height).toBeLessThanOrEqual(barBox!.y)

  // Notas holds "Tus notas", including the minimum-servings control.
  await notesTab.click()
  const notesPanel = page.getByRole('tabpanel', { name: /notas/i })
  await expect(notesPanel.getByText('Tus notas')).toBeVisible()
  await expect(notesPanel.getByRole('button', { name: /siempre la cocino para más gente/i })).toBeVisible()
  await expect(notesPanel.getByRole('button', { name: /marcar como cocinada/i })).toBeVisible()
  // The tab is kept in the URL so a reload reopens it.
  await expect(page).toHaveURL(/#notas$/)
})
