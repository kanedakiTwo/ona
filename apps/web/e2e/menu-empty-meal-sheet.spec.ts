/**
 * Miguel, 2026-11-05: «si hay algún día que no tiene comida y le doy, quiero
 * que directamente me aparezca el menú contextual». Vista día, mobile (390×844):
 *   - an empty meal («Comida · Añadir plato»): tapping the card opens the
 *     same sheet as its «···» (Añadir plato, Fijar, Comensales, Quitar);
 *   - a missing meal («El martes no hay comida»): tapping it opens what to
 *     put there (Elegir receta, Una al azar, a táper) and «Elegir receta»
 *     adds the recipe picked, instead of a dish nobody chose.
 */
import { test, expect, type Page } from '@playwright/test'
import { addMealWithRecipe, completeOnboarding, registerFreshUser } from './_helpers'
import { pinClock, pinnedDay } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'
const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

test.use({ timezoneId: 'Europe/Madrid', viewport: { width: 390, height: 844 } })

/** Register, generate this week, and give every day a lunch; returns what the specs need. */
async function weekWithLunches(page: Page) {
  await pinClock(page)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const headers = { Authorization: `Bearer ${token}` }
  const weekStart = pinnedDay().weekStart
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const menu = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  for (let d = 0; d < 7; d++) {
    if (menu.days[d]?.lunch?.dishes?.some((x: { kind: string }) => x.kind === 'recipe')) continue
    if (menu.days[d]?.lunch) await page.request.delete(`${API}/menu/${menu.id}/day/${d}/meal/lunch`, { headers })
    const r = await addMealWithRecipe(page, headers, menu, d, 'lunch')
    expect(r.ok(), `lunch on day ${d}: ${r.status()}`).toBeTruthy()
  }
  return { menu, headers, userId, weekStart }
}

/** A day other than today, so its lunch isn't the hero of the first screen. */
const otherDay = () => (pinnedDay().dayIdx === 1 ? 2 : 1)

async function openDay(page: Page, day: number) {
  await page.goto('/menu')
  const strip = page.getByRole('navigation', { name: 'Días de la semana' })
  await expect(strip).toBeVisible({ timeout: 20_000 })
  await strip.getByRole('button').nth(day).click()
  await expect(strip.getByRole('button').nth(day)).toHaveAttribute('aria-pressed', 'true')
}

test('tapping an empty meal opens its «···» sheet', async ({ page }) => {
  test.setTimeout(120_000)
  const { menu, headers } = await weekWithLunches(page)
  const day = otherDay()
  // Its only dish out: the lunch stays, empty.
  const del = await page.request.delete(`${API}/menu/${menu.id}/day/${day}/meal/lunch/dish/0`, { headers })
  expect(del.ok(), `remove dish: ${del.status()}`).toBeTruthy()

  await openDay(page, day)
  await page.getByTestId('empty-meal').first().click()
  const sheet = page.getByRole('dialog', { name: 'Sin plato todavía' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button', { name: /^añadir plato/i })).toBeVisible()
  await expect(sheet.getByRole('button', { name: /^fijar/i })).toBeVisible()
  await expect(sheet.getByRole('button', { name: /^quitar comida/i })).toBeVisible()
})

test('tapping «El … no hay comida» offers what to put there, and «Elegir receta» adds the one picked', async ({ page }) => {
  test.setTimeout(120_000)
  const { menu, headers, userId, weekStart } = await weekWithLunches(page)
  const day = otherDay()
  const del = await page.request.delete(`${API}/menu/${menu.id}/day/${day}/meal/lunch`, { headers })
  expect(del.ok(), `delete lunch: ${del.status()}`).toBeTruthy()

  await openDay(page, day)
  const absent = page.locator('[data-testid="absent-meal"][data-meal="lunch"]')
  await expect(absent).toContainText(`El ${WEEKDAYS[day]} no hay comida`)
  let posted = false
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith(`/menu/${menu.id}/day/${day}/meal/lunch`)) posted = true
  })
  await absent.getByRole('button', { name: `Añadir comida al ${WEEKDAYS[day]}` }).click()
  const sheet = page.getByRole('dialog', { name: 'Sin plato todavía' })
  await expect(sheet.getByRole('button', { name: /^una al azar/i })).toBeVisible()
  await expect(sheet.getByRole('button', { name: /^del congelador/i })).toBeVisible()
  await expect(sheet.getByRole('button', { name: /^táper de la nevera/i })).toBeVisible()
  expect(posted, 'opening the sheet adds nothing').toBe(false)

  await sheet.getByRole('button', { name: /^elegir receta/i }).click()
  const picker = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: `Comida del ${WEEKDAYS[day]}` }) })
  const first = picker.locator('ul button').first()
  await expect(first).toBeVisible({ timeout: 15_000 })
  const added = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/menu/${menu.id}/day/${day}/meal/lunch`),
  )
  await first.click()
  const res = await added
  expect(res.ok(), `add: ${res.status()}`).toBeTruthy()
  const pickedId = JSON.parse(res.request().postData() ?? '{}').recipeId as string
  expect(pickedId, 'the picked recipe goes in the request').toBeTruthy()
  await expect(absent).toHaveCount(0, { timeout: 10_000 })
  const after = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  expect(after.days[day].lunch.dishes[0]).toMatchObject({ kind: 'recipe', recipeId: pickedId })
})
