/**
 * PRO-110 «¿Qué tal?» after cooking (specs/cook-log.md): «Marcar como
 * cocinada» on the menu and «Terminar» in cook mode ask once, and the answer
 * lands in the household's existing rating (Repetir a menudo 5 · Bien 3 ·
 * Mejor no 1). Rated in the last 30 days → not asked again (rule unit-tested
 * in apps/api/src/tests/ratingPrompt.test.ts).
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'
import { madridTodayIdx, madridWeekStart, pinClock } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'
const MEALS = ['breakfast', 'lunch', 'snack', 'dinner']


async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { headers: { Authorization: `Bearer ${token}` }, userId }
}

async function rating(page: Page, recipeId: string): Promise<number | null> {
  const { headers } = await session(page)
  const body = await (await page.request.get(`${API}/recipes/${recipeId}/notes`, { headers })).json()
  return body?.rating ?? null
}

test('menu: «Marcar como cocinada» asks «¿Qué tal?»; «Repetir a menudo» leaves 5 stars; not asked again', async ({ page }) => {
  test.setTimeout(120_000)
  await pinClock(page, madridTodayIdx())
  await registerFreshUser(page)
  await completeOnboarding(page)
  const { headers, userId } = await session(page)
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart: madridWeekStart(), force: true } })
  expect(gen.ok()).toBeTruthy()
  const menu = await (await page.request.get(`${API}/menu/${userId}/${madridWeekStart()}`, { headers })).json()
  const today = menu.days[madridTodayIdx()] ?? {}
  const recipeId: string | undefined = MEALS.map((m) => today[m]?.dishes?.find((d: any) => d.kind === 'recipe')?.recipeId).find(Boolean)
  test.skip(!recipeId, 'the generator left today without recipes')

  await page.goto('/menu')
  const hero = page.getByTestId('menu-hero')
  await expect(hero).toBeVisible({ timeout: 20_000 })
  await hero.getByRole('button', { name: /más opciones/i }).click()
  await page.getByRole('dialog').getByRole('button', { name: /marcar como cocinada/i }).click()

  const prompt = page.getByTestId('rating-prompt')
  await expect(prompt).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('dialog', { name: '¿Qué tal?' })).toBeVisible()
  await prompt.getByRole('button', { name: 'Repetir a menudo' }).click()
  await expect(prompt).toBeHidden()
  await expect.poll(() => rating(page, recipeId!)).toBe(5)

  // The recipe shows 5 stars.
  await page.goto(`/recipes/${recipeId}#notas`)
  await expect(page.getByRole('button', { name: '5 de 5' })).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })

  // Second time within 30 days: no question. The meal is now «Comido»
  // (PRO-185), so «Desmarcar» it first to get «Marcar como cocinada» back.
  const meal = MEALS.find((m) => today[m]?.dishes?.some((d: any) => d.kind === 'recipe'))
  expect((await page.request.patch(`${API}/menu/${menu.id}/day/${madridTodayIdx()}/meal/${meal}`, { headers, data: { eaten: false } })).ok()).toBeTruthy()
  await page.goto('/menu')
  await expect(hero).toBeVisible({ timeout: 20_000 })
  await hero.getByRole('button', { name: /más opciones/i }).click()
  const cooked = page.waitForResponse((r) => r.url().endsWith('/cook-logs') && r.request().method() === 'POST')
  await page.getByRole('dialog').getByRole('button', { name: /marcar como cocinada/i }).click()
  expect((await (await cooked).json()).askRating).toBe(false)
  await page.waitForTimeout(800)
  await expect(page.getByTestId('rating-prompt')).toHaveCount(0)
})

test('cook mode: «Terminar» on the last step records the dish and asks; «Bien» is 3 stars', async ({ page }) => {
  test.setTimeout(90_000)
  await pinClock(page, madridTodayIdx())
  await registerFreshUser(page)
  await completeOnboarding(page)
  await page.goto('/recipes')
  const card = page.getByRole('main').locator('a[href^="/recipes/"]:not([href="/recipes/new"])').first()
  await expect(card).toBeVisible({ timeout: 15_000 })
  const href = (await card.getAttribute('href'))!
  const recipeId = href.match(/[0-9a-f-]{36}/)![0]

  await page.goto(`/recipes/${recipeId}/cook`)
  const next = page.getByRole('button', { name: 'Paso siguiente' })
  const finish = page.getByRole('button', { name: /^terminar$/i })
  await expect(next.or(finish)).toBeVisible({ timeout: 15_000 })
  for (let i = 0; i < 40 && !(await finish.isVisible()); i++) await next.click()

  const cooked = page.waitForResponse((r) => r.url().endsWith('/cook-logs') && r.request().method() === 'POST')
  await finish.click()
  expect((await cooked).status()).toBe(201)
  const prompt = page.getByTestId('rating-prompt')
  await expect(prompt).toBeVisible({ timeout: 10_000 })
  await prompt.getByRole('button', { name: 'Bien' }).click()
  await page.waitForURL((u) => u.pathname === `/recipes/${recipeId}`, { timeout: 15_000 })
  await expect.poll(() => rating(page, recipeId)).toBe(3)
})
