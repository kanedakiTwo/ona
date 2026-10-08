/**
 * PRO-04: "Añadir al menú" from the recipe detail. A bottom sheet lists the
 * 7 days of this week with comida / cena; a free slot takes the recipe and
 * an occupied one swaps its dish for it. Mobile (390×844).
 */

import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

interface Slot { dishes: Array<{ kind: string; recipeId?: string; recipeName?: string }> }
interface Menu { id: string; days: Array<Record<string, Slot | undefined>> }

async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user')))!)
  // The sheet works on the browser's local Monday; ask the browser for it.
  const weekStart = await page.evaluate(() => {
    const d = new Date()
    const diff = d.getDay() === 0 ? -6 : 1 - d.getDay()
    d.setDate(d.getDate() + diff)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  return { auth: { Authorization: `Bearer ${token}` }, userId: user.id as string, weekStart }
}

async function getMenu(page: Page, s: Awaited<ReturnType<typeof session>>): Promise<Menu | null> {
  const r = await page.request.get(`${API_URL}/menu/${s.userId}/${s.weekStart}`, { headers: s.auth })
  return r.ok() ? r.json() : null
}

const recipeIdAt = (m: Menu, day: number, meal: string) =>
  m.days[day]?.[meal]?.dishes.find((d) => d.kind === 'recipe')?.recipeId ?? null

test('add a recipe to a free slot and replace an occupied one from the detail', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  const s = await session(page)

  // A menu for this week (onboarding may already have made one).
  let menu = await getMenu(page, s)
  if (!menu) {
    const gen = await page.request.post(`${API_URL}/menu/generate`, {
      headers: s.auth,
      data: { userId: s.userId, weekStart: s.weekStart },
    })
    expect(gen.ok(), await gen.text()).toBe(true)
    menu = (await gen.json()) as Menu
  }

  // Sunday dinner free (slot removed), Sunday lunch occupied by some recipe.
  if (menu.days[6]?.dinner) {
    const del = await page.request.delete(`${API_URL}/menu/${menu.id}/day/6/meal/dinner`, { headers: s.auth })
    expect(del.ok()).toBe(true)
  }
  // Two catalogue recipes: one to occupy Sunday lunch, one to add.
  const list: Array<{ id: string }> = await (await page.request.get(`${API_URL}/recipes?perPage=20`)).json()
  expect(list.length).toBeGreaterThan(1)
  const [occupant, recipe] = list
  const fill = menu.days[6]?.lunch
    ? await page.request.put(`${API_URL}/menu/${menu.id}/day/6/meal/lunch`, { headers: s.auth, data: { recipeId: occupant.id } })
    : await page.request.post(`${API_URL}/menu/${menu.id}/day/6/meal/lunch`, { headers: s.auth, data: { recipeId: occupant.id } })
  expect(fill.ok(), await fill.text()).toBe(true)
  menu = (await getMenu(page, s))!
  expect(recipeIdAt(menu, 6, 'lunch')).toBe(occupant.id)
  expect(recipeIdAt(menu, 6, 'dinner')).toBeNull()

  await page.goto(`/recipes/${recipe.id}`)
  const open = page.getByRole('button', { name: 'Añadir al menú' })
  await expect(open).toBeVisible({ timeout: 15_000 })

  // Free slot → added.
  await open.click()
  const sheet = page.getByRole('dialog', { name: 'Añadir al menú' })
  await expect(sheet).toBeVisible()
  const dinner = sheet.getByTestId('add-to-menu-6-dinner')
  await expect(dinner).toContainText('Libre', { timeout: 15_000 })
  await dinner.click()
  await expect(sheet.getByRole('status')).toContainText('domingo, cena')
  await expect.poll(async () => recipeIdAt((await getMenu(page, s))!, 6, 'dinner')).toBe(recipe.id)

  // Occupied slot → shows its dish, replaced.
  await sheet.getByRole('button', { name: 'Seguir aquí' }).click()
  await expect(sheet).toBeHidden()
  await open.click()
  const lunch = page.getByRole('dialog', { name: 'Añadir al menú' }).getByTestId('add-to-menu-6-lunch')
  await expect(lunch).toHaveAttribute('aria-label', /Sustituir/, { timeout: 15_000 })
  await lunch.click()
  await expect(page.getByRole('dialog', { name: 'Añadir al menú' }).getByRole('status')).toContainText('domingo, comida')
  await expect.poll(async () => recipeIdAt((await getMenu(page, s))!, 6, 'lunch')).toBe(recipe.id)
})
