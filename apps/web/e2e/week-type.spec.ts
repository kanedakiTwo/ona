/**
 * «Semana tipo» (D-182), phase 1:
 * - saving the profile never wipes the household's week type (its plantilla
 *   card writes only the slots changed there);
 * - a generated week follows its slots two weeks running, and the menu shows it.
 * Design: docs/superpowers/specs/2026-11-11-semana-tipo-design.md §9.
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

test('saving the profile keeps the week type and writes only the slot changed in the card', async ({ page }) => {
  test.setTimeout(60_000)
  const { headers } = await auth(page)
  // Friday dinner: pizza (as Mimo or, in phase 2, the grid will set it).
  const put = await page.request.put(`${API_URL}/households/me/week-type/4/dinner`, { headers, data: { options: [{ kind: 'type', type: 'pizza' }] } })
  expect(put.ok()).toBe(true)

  // The card shows the week type once it is read: wait for it before touching it.
  const loaded = page.waitForResponse((r) => r.url().includes('/households/me/week-type') && r.request().method() === 'GET')
  await page.goto('/profile')
  await loaded
  // One more diner at Monday's lunch in «Plantilla semanal».
  const more = page.getByRole('button', { name: 'Más comensales en almuerzo lunes' })
  await expect(more).toBeVisible({ timeout: 15_000 })
  const cell = more.locator('xpath=..')
  const before = Number(await cell.locator('span').textContent())
  await more.click()
  await page.getByRole('button', { name: /guardar cambios/i }).click()
  await expect(page.getByText(/guardado/i).first()).toBeVisible({ timeout: 10_000 })

  const wt = await (await page.request.get(`${API_URL}/households/me/week-type`, { headers })).json()
  expect(wt.days[4].dinner.options).toEqual([{ kind: 'type', type: 'pizza' }])
  expect(wt.days[0].lunch.diners).toBe(before + 1)
  // The rest of the week as it was: lunch and dinner, no breakfast.
  expect(wt.days[2].breakfast).toEqual({ off: true })
  expect(wt.days[2].dinner.options).toBeUndefined()

  // Saving again without touching the card changes nothing.
  const reloaded = page.waitForResponse((r) => r.url().includes('/households/me/week-type') && r.request().method() === 'GET')
  await page.reload()
  await reloaded
  await expect(page.getByRole('button', { name: 'Más comensales en almuerzo lunes' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /guardar cambios/i }).click()
  await expect(page.getByText(/guardado/i).first()).toBeVisible({ timeout: 10_000 })
  expect(await (await page.request.get(`${API_URL}/households/me/week-type`, { headers })).json()).toEqual(wt)

  // «Platos fijos»: Friday's pizza is a line with «Quitar», and «Quitar» leaves that dinner free.
  const fixed = page.getByRole('group', { name: 'Platos fijos' })
  await expect(fixed).toContainText('Viernes · cena: Pizza')
  await fixed.getByRole('button', { name: 'Quitar Pizza del viernes' }).click()
  await expect(fixed).toHaveCount(0)
  const after = await (await page.request.get(`${API_URL}/households/me/week-type`, { headers })).json()
  expect(after.days[4].dinner.options).toBeUndefined()
  expect(after.days[0].lunch.diners).toBe(before + 1)
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
