/**
 * PRO-1046 · El lote del domingo sale el domingo, no el lunes (Dani y Sara,
 * 2026-10-25): their Sunday showed «Día marcado sin cocinar» and the bowl ×8
 * sat on Monday as a dish to cook. Now, with a Sunday batch:
 *   - Monday's lunch → «Más opciones» → «Ya está hecho / táper» → «Lo cocino
 *     en el lote del domingo»: Monday shows «Táper del lote del domingo», no
 *     «Empezar a cocinar»; Tuesday to Thursday stay its leftovers;
 *   - the Sunday before (today, pinned), even marked «sin cocinar», shows
 *     «Cocinas hoy» and «<plato> ×N (para lunes a jueves)».
 * The rule is unit-tested in apps/api/src/tests/batchDay.test.ts.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, menuWithRecipesOn, registerFreshUser } from './_helpers'
import { madridMondayIn, pinClock } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'

async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { headers: { Authorization: `Bearer ${token}` }, userId }
}

test.use({ viewport: { width: 390, height: 844 } })

test('a Sunday batch: Sunday says «Cocinas hoy … ×N (para lunes a jueves)» and Monday is a táper of it', async ({ page }) => {
  test.setTimeout(150_000)
  // Today is this week's Sunday; the batch feeds next week.
  const { weekStart: thisWeek } = await pinClock(page, 6)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const { headers, userId } = await session(page)
  const nextWeek = madridMondayIn(1)
  const sunday = new Date(`${nextWeek}T12:00:00Z`)
  sunday.setUTCDate(sunday.getUTCDate() - 1)
  const sundayIso = sunday.toISOString().slice(0, 10)

  for (const weekStart of [thisWeek, nextWeek]) {
    const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
    expect(gen.ok(), `generate ${weekStart}: ${gen.status()}`).toBeTruthy()
  }
  // Sunday «sin cocinar», as Dani y Sara had it.
  const current = await (await page.request.get(`${API}/menu/${userId}/${thisWeek}`, { headers })).json()
  expect((await page.request.post(`${API}/menu/${current.id}/day/6/skip`, { headers })).ok()).toBeTruthy()

  // Next Monday's lunch with a recipe, and its leftovers Tuesday to Thursday.
  const menu = await menuWithRecipesOn(page, headers, userId, nextWeek, [[0, 'lunch']])
  const name = menu.days[0].lunch.dishes.find((d: { kind: string }) => d.kind === 'recipe').recipeName as string
  for (const day of [1, 2, 3]) {
    if (menu.days[day]?.lunch) await page.request.delete(`${API}/menu/${menu.id}/day/${day}/meal/lunch`, { headers })
    const lo = await page.request.post(`${API}/menu/${menu.id}/day/${day}/leftover`, {
      headers,
      data: { sourceDay: 0, sourceMeal: 'lunch', targetMeal: 'lunch' },
    })
    expect(lo.ok(), `leftover on day ${day}: ${lo.status()}`).toBeTruthy()
  }

  // Monday: «Lo cocino en el lote del domingo».
  await page.goto(`/menu?week=${nextWeek}`)
  const hero = page.getByTestId('menu-hero')
  await expect(hero).toBeVisible({ timeout: 20_000 })
  await expect(hero.getByRole('link', { name: /empezar a cocinar/i })).toBeVisible()
  await hero.getByRole('button', { name: /^Más opciones de comida/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Más opciones$/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Ya está hecho/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Lo cocino en el lote del domingo/ }).click()

  await expect(hero.getByTestId('batch-taper')).toHaveText(/táper del lote del domingo/i, { timeout: 10_000 })
  await expect(hero.getByRole('link', { name: /empezar a cocinar/i })).toHaveCount(0)
  await expect(hero.getByTestId('taper-see-recipe')).toBeVisible()
  await expect
    .poll(async () => {
      const m = await (await page.request.get(`${API}/menu/${userId}/${nextWeek}`, { headers })).json()
      return m.days[0].lunch.dishes.find((d: { kind: string }) => d.kind === 'recipe')?.batchDate ?? null
    }, { timeout: 10_000 })
    .toBe(sundayIso)
  // Tuesday is still its leftovers.
  await page.getByRole('navigation', { name: 'Días de la semana' }).getByRole('button').nth(1).click()
  await expect(page.getByText(/sobras de lun comida · ya en la compra/i).first()).toBeVisible({ timeout: 10_000 })

  // Sunday (today): «Cocinas hoy», even though the day is «sin cocinar».
  await page.goto('/menu')
  const batch = page.getByTestId('batch-day')
  await expect(batch).toBeVisible({ timeout: 20_000 })
  await expect(batch.getByRole('heading', { name: 'Cocinas hoy' })).toBeVisible()
  const line = batch.locator(`[data-batch-dish="${name}"]`)
  await expect(line).toContainText(/×\d+ \(para lunes a jueves\)/)
  await expect(line.getByRole('link', { name: `Cocinar ${name}` })).toHaveAttribute('href', /\/cook\?servings=\d+/)
  await expect(page.getByText('Día marcado sin cocinar.')).toBeVisible()

  // «Lo cocino su día» undoes it: Sunday has nothing to cook again.
  await page.goto(`/menu?week=${nextWeek}`)
  await expect(hero).toBeVisible({ timeout: 20_000 })
  await hero.getByRole('button', { name: /^Más opciones de comida/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Más opciones$/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Ya está hecho/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Lo cocino su día/ }).click()
  await expect(hero.getByRole('link', { name: /empezar a cocinar/i })).toBeVisible({ timeout: 10_000 })
  await page.goto('/menu')
  await expect(page.getByText('Día marcado sin cocinar.')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('batch-day')).toHaveCount(0)
})
