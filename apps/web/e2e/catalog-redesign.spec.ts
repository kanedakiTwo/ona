/**
 * `/recipes` redesign ("D · Luz y foto", 2026-10-08).
 *
 * Fails on the old catalogue, which had: a 3-way "Todas / Mis recetas /
 * Catálogo" tab bar above the search, a separate meal-chip row, a badge with
 * the old brand name on every card and a season badge built from `recipe.seasons[0]` —
 * "PRIMAVERA" on nearly every card in October. Cards are now photo + time
 * pill + title only; "Selección Mimoia" exists only as a chip.
 *
 * The page clock is pinned to 8 Oct 2026 so "De temporada" means otoño.
 */

import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const apiUrl = process.env.API_URL ?? 'http://localhost:8765'
const AUTUMN_DAY = new Date('2026-10-08T12:00:00')

type Card = { id: string; name: string; authorId: string | null; seasons: string[] }

async function openCatalog(page: Page) {
  await page.goto('/recipes')
  const cards = page.getByTestId('recipe-card')
  try {
    await cards.first().waitFor({ state: 'visible', timeout: 15_000 })
  } catch {
    test.skip(true, 'Empty catalog — seed step did not produce recipes')
  }
  return cards
}

const chipRow = (page: Page) => page.getByRole('group', { name: 'Filtros rápidos' })

test.beforeEach(async ({ page }) => {
  // Register + onboarding + two page loads: `next dev` compiles on first hit.
  test.setTimeout(60_000)
  await page.clock.setFixedTime(AUTUMN_DAY)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('one chip row replaces the scope tabs + meal chips', async ({ page }) => {
  await openCatalog(page)

  await expect(page.getByRole('heading', { level: 1, name: 'Recetas' })).toBeVisible()
  await expect(page.getByText('Buen', { exact: true })).toHaveCount(0)

  const row = chipRow(page)
  for (const name of ['De temporada', 'En 30 min', 'Desayuno', 'Comida', 'Cena', 'Snack', 'Selección Mimoia', 'Mis recetas']) {
    await expect(row.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'false')
  }
  // The old segmented control is gone ("Todas" = no chip active).
  await expect(page.getByText(/cat[aá]logo ona/i)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Todas', exact: true })).toHaveCount(0)

  // Toggling a chip presses it, and pressing it again releases it.
  const quick = row.getByRole('button', { name: 'En 30 min' })
  await quick.click()
  await expect(quick).toHaveAttribute('aria-pressed', 'true')
  await quick.click()
  await expect(quick).toHaveAttribute('aria-pressed', 'false')
})

test('cards carry no season / old-brand / seal badge; "De temporada" follows the real season', async ({ page }) => {
  await openCatalog(page)
  const main = page.getByRole('main')

  // Old UI: "Primavera" (CSS-uppercased) on almost every card in October.
  await expect(main.getByText(/^(primavera|verano|otoño|invierno)$/i)).toHaveCount(0)
  await expect(main.getByText(/^(ONA|Ona)$/)).toHaveCount(0)
  // Nothing on a card but photo, time pill and title: no per-card mark either.
  await expect(main.getByRole('img', { name: /selecci[oó]n mimoia/i })).toHaveCount(0)
  await expect(page.getByTestId('recipe-card').first().getByText(/selecci[oó]n mimoia/i)).toHaveCount(0)

  // The hero, when there is one, is always in season.
  const hero = page.getByTestId('featured-recipe')
  if (await hero.count()) await expect(hero.first()).toContainText(/^De temporada/i)

  // "De temporada" in October drops spring/summer-only recipes and keeps autumn ones.
  const all = (await (await page.request.get(`${apiUrl}/recipes?perPage=100`)).json()) as Card[]
  const outOfSeason = all.find((r) => r.seasons.length > 0 && !r.seasons.includes('autumn'))
  const autumnOnly = all.find((r) => r.seasons.includes('autumn') && r.seasons.length < 4)

  await chipRow(page).getByRole('button', { name: 'De temporada' }).click()
  await expect(chipRow(page).getByRole('button', { name: 'De temporada' })).toHaveAttribute('aria-pressed', 'true')
  if (outOfSeason) await expect(main.getByText(outOfSeason.name, { exact: true })).toHaveCount(0)
  if (autumnOnly) await expect(main.getByText(autumnOnly.name, { exact: true }).first()).toBeVisible()
})

test('"Selección Mimoia" shows only system recipes, "Mis recetas" only mine', async ({ page }) => {
  // Give the user one recipe of their own: copy a system one.
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const [system] = (await (await page.request.get(`${apiUrl}/recipes?perPage=1`)).json()) as Card[]
  test.skip(!system, 'Empty catalog — seed step did not produce recipes')
  const copyRes = await page.request.post(`${apiUrl}/recipes/${system.id}/copy`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(copyRes.ok()).toBeTruthy()
  const mine = (await copyRes.json()) as Card

  // System recipe ids (anonymous listing = curated catalogue only).
  const systemIds = new Set(
    ((await (await page.request.get(`${apiUrl}/recipes?perPage=100`)).json()) as Card[]).map((r) => r.id),
  )

  const cards = await openCatalog(page)
  const cardIds = () =>
    cards.evaluateAll((els) => els.map((a) => (a.getAttribute('href') ?? '').split('/').pop() ?? ''))

  await chipRow(page).getByRole('button', { name: 'Selección Mimoia' }).click()
  await expect(chipRow(page).getByRole('button', { name: 'Selección Mimoia' })).toHaveAttribute('aria-pressed', 'true')
  await expect(cards.first()).toBeVisible()
  const curatedCount = await cards.count()
  expect(curatedCount).toBeGreaterThan(0)
  // Every card is a system recipe; the user's copy is not listed.
  const curatedIds = await cardIds()
  expect(curatedIds.every((id) => systemIds.has(id))).toBe(true)
  expect(curatedIds).not.toContain(mine.id)

  await chipRow(page).getByRole('button', { name: 'Mis recetas' }).click()
  await expect(chipRow(page).getByRole('button', { name: 'Selección Mimoia' })).toHaveAttribute('aria-pressed', 'false')
  await expect(cards).toHaveCount(1)
  await expect(cards.first().getByText(mine.name, { exact: true })).toBeVisible()
  expect(await cardIds()).toEqual([mine.id])
})

test('the filters button still opens the advanced filters', async ({ page }) => {
  await openCatalog(page)

  const button = page.getByRole('button', { name: 'Más filtros' })
  await button.click()
  const dialog = page.getByRole('dialog', { name: 'Filtros' })
  await expect(dialog).toBeVisible()
  for (const group of ['Temporada', 'Tiempo total', 'Comida', 'Recetas']) {
    await expect(dialog.getByRole('group', { name: group })).toBeVisible()
  }

  // A filter with no chip in the row (Primavera in October) shows up as a badge.
  await dialog.getByRole('group', { name: 'Temporada' }).getByRole('button', { name: 'Primavera' }).click()
  await expect(dialog.getByRole('button', { name: 'Primavera' })).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: /^Ver \d+ recetas?$/ }).click()
  await expect(dialog).toHaveCount(0)
  await expect(button).toContainText('1')
  await expect(chipRow(page).getByRole('button', { name: 'De temporada' })).toHaveAttribute('aria-pressed', 'false')

  // Escape closes it too.
  await button.click()
  await expect(page.getByRole('dialog', { name: 'Filtros' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Filtros' })).toHaveCount(0)
})
