/**
 * «Rehacer la semana con mis favoritas» (PRO-377, specs/menus.md): from the
 * week's «···» sheet, the week comes out of the household's favourites; with
 * only two, the rest comes from the catalogue and the page says how many.
 */
import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'
import { madridWeekStart } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'

type Day = Record<string, { dishes?: Array<{ kind: string; recipeId?: string }> }>
const recipeIds = (days: Day[]) =>
  days.flatMap((d) => Object.values(d ?? {}).flatMap((s) => (s?.dishes ?? []).flatMap((x) => (x.kind === 'recipe' && x.recipeId ? [x.recipeId] : []))))

test('the week with my favourites: both come out and the page says how many are new', async ({ page }) => {
  test.setTimeout(120_000)
  await registerFreshUser(page)
  await completeOnboarding(page)

  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const headers = { Authorization: `Bearer ${token}` }

  // A normal week, and two of its recipes go to favourites.
  const first = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart: madridWeekStart(), force: true } })
  expect(first.ok()).toBeTruthy()
  const favourites = [...new Set(recipeIds((await first.json()).days))].slice(0, 2)
  expect(favourites).toHaveLength(2)
  for (const id of favourites) {
    const fav = await page.request.post(`${API}/user/${userId}/recipes/${id}/favorite`, { headers })
    expect(fav.ok()).toBeTruthy()
  }

  await page.goto('/menu')
  await page.getByRole('button', { name: 'Opciones de la semana' }).click()
  const generated = page.waitForResponse((r) => r.url().endsWith('/menu/generate') && r.request().method() === 'POST')
  await page.getByRole('dialog').getByRole('button', { name: /rehacer la semana con mis favoritas/i }).click()
  const res = await generated
  expect(res.status()).toBe(201)
  const body = await res.json()
  const ids = recipeIds(body.days)
  for (const id of favourites) expect(ids).toContain(id)
  expect(body.favoritesShort).toBe(ids.filter((id) => !favourites.includes(id)).length)

  await expect(page.getByTestId('favorites-short')).toHaveText(`Tenías pocas favoritas: ${body.favoritesShort} platos son nuevos.`)
})
