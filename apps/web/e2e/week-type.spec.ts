/**
 * «Semana tipo» (D-182):
 * - saving the profile never changes the household's week type;
 * - «Tu semana tipo» (phase 2), end to end: a type, «cada 2», turns,
 *   together, remove and «no hay», and the next generated week follows it;
 * - a generated week follows its slots two weeks running, and the menu shows it.
 * Design: docs/superpowers/specs/2026-11-11-semana-tipo-design.md §4, §9.
 */

import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

async function auth(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { headers: { Authorization: `Bearer ${token}` }, userId }
}

function monday(offsetWeeks: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 7 * offsetWeeks)
  return d.toISOString().slice(0, 10)
}

test('saving the profile never changes the week type', async ({ page }) => {
  test.setTimeout(60_000)
  const { headers } = await auth(page)
  expect((await page.request.put(`${API_URL}/households/me/week-type/4/dinner`, { headers, data: { options: [{ kind: 'type', type: 'pizza' }] } })).ok()).toBe(true)
  const before = await (await page.request.get(`${API_URL}/households/me/week-type`, { headers })).json()
  // Since PRO-1203 the profile's settings blob is saved from «Salud y objetivo», in your row of «Quién come».
  await page.goto('/profile/quien/me')
  const card = page.getByTestId('health-and-goal')
  const consent = card.getByRole('checkbox', { name: /datos de salud/i })
  await consent.click()
  await expect(consent).toBeChecked({ timeout: 10_000 })
  await card.getByRole('button', { name: /^guardar$/i }).click()
  await expect(card.getByText(/guardado/i)).toBeVisible({ timeout: 10_000 })
  expect(await (await page.request.get(`${API_URL}/households/me/week-type`, { headers })).json()).toEqual(before)
})

test('«Tu semana tipo», end to end: a type, «cada 2», turns, together, remove and «no hay»', async ({ page }) => {
  test.setTimeout(120_000)
  const { headers, userId } = await auth(page)
  const weekType = async () => (await (await page.request.get(`${API_URL}/households/me/week-type`, { headers })).json()).days
  const loaded = page.waitForResponse((r) => r.url().includes('/households/me/week-type') && r.request().method() === 'GET')
  await page.goto('/profile')
  await page.getByRole('link', { name: /Tu semana tipo/ }).click()
  await loaded
  await expect(page.getByRole('heading', { name: /Tu semana tipo/ })).toBeVisible()

  // Friday dinner → Pizza.
  await page.getByTestId('wt-cell-4-dinner').click()
  const panel = page.getByTestId('wt-panel')
  await panel.getByRole('button', { name: 'Añadir' }).click()
  await page.getByTestId('wt-picker').getByRole('button', { name: 'Pizza', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Quitar Pizza' })).toBeVisible()
  await expect.poll(async () => (await weekType())[4].dinner.options).toEqual([{ kind: 'type', type: 'pizza' }])

  // «Cada 2»: one week pizza, the next anything.
  await panel.getByRole('button', { name: 'Cada 2' }).click()
  await expect.poll(async () => (await weekType())[4].dinner.options).toEqual([{ kind: 'type', type: 'pizza' }, { kind: 'any' }])
  await expect(page.getByTestId('wt-preview')).toContainText('Cualquier receta')

  // A second option: by turns, then together.
  await panel.getByRole('button', { name: 'Añadir' }).click()
  await page.getByTestId('wt-picker').getByRole('button', { name: 'Ceviche', exact: true }).click()
  await expect.poll(async () => (await weekType())[4].dinner.options).toEqual([{ kind: 'type', type: 'pizza' }, { kind: 'type', type: 'ceviche' }])
  await panel.getByRole('button', { name: 'Juntos' }).click()
  await expect.poll(async () => (await weekType())[4].dinner.together).toBe(true)

  // Remove the ceviche: back to pizza alone, every week.
  await panel.getByRole('button', { name: 'Quitar Ceviche' }).click()
  await expect.poll(async () => (await weekType())[4].dinner).toMatchObject({ options: [{ kind: 'type', type: 'pizza' }] })
  expect((await weekType())[4].dinner.together).toBeUndefined()

  // Sunday: no dinner.
  await page.keyboard.press('Escape')
  await page.getByTestId('wt-cell-6-dinner').click()
  await page.getByTestId('wt-panel').getByRole('button', { name: 'No hay cena este día' }).click()
  await expect.poll(async () => (await weekType())[6].dinner.off).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('wt-cell-6-dinner')).toHaveAttribute('aria-label', 'Domingo, cena: no hay')
  await expect(page.getByTestId('wt-cell-4-dinner')).toHaveAttribute('aria-label', 'Viernes, cena: Pizza')

  // The next week follows it.
  const gen = await page.request.post(`${API_URL}/menu/generate`, { headers, data: { userId, weekStart: monday(1) } })
  expect(gen.ok()).toBe(true)
  const menu = await gen.json()
  const friday = menu.days[4].dinner.dishes[0]
  expect(friday.kind === 'recipe' ? friday.recipeName : friday.text).toMatch(/pizza/i)
  expect(menu.days[6].dinner).toBeUndefined()
})

test('a generated week follows the week type two weeks running', async ({ page }) => {
  test.setTimeout(120_000)
  const { headers, userId } = await auth(page)
  // Friday dinner: always «Pizza»; Sunday: no dinner.
  expect((await page.request.put(`${API_URL}/households/me/week-type/4/dinner`, { headers, data: { options: [{ kind: 'fixed', label: 'Pizza casera', items: [] }] } })).ok()).toBe(true)
  expect((await page.request.put(`${API_URL}/households/me/week-type/6/dinner`, { headers, data: { off: true } })).ok()).toBe(true)

  for (const weekStart of [monday(1), monday(2)]) {
    const gen = await page.request.post(`${API_URL}/menu/generate`, { headers, data: { userId, weekStart } })
    expect(gen.ok()).toBe(true)
    const menu = await gen.json()
    expect(menu.days[4].dinner.dishes).toEqual([{ kind: 'note', text: 'Pizza casera', fixedDish: true }])
    expect(menu.days[6].dinner).toBeUndefined()
  }

  // The menu shows Friday's dinner as the household said.
  await page.goto(`/menu?week=${monday(1)}`)
  await page.getByRole('navigation', { name: 'Días de la semana' }).getByRole('button', { name: /^viernes/i }).click()
  await expect(page.getByText('Pizza casera').first()).toBeVisible({ timeout: 15_000 })
})
