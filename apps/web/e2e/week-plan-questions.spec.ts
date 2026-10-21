/**
 * PRO-225 · «Antes de planificar» on /menu: two optional taps above
 * «Generar mi menú». Skipped, the week is generated as always; answered
 * («Jue · Cena fuera», «Mar: somos 6»), that week has no Thursday dinner and
 * 6 diners on Tuesday, and the saved plantilla is untouched. PRO-229: what's
 * left in the fridge goes in the same step and lands in the despensa (nevera),
 * read into foods (PRO-295); an allergy in it asks before generating.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const API = process.env.API_URL ?? 'http://localhost:8765'

function mondayIn(weeks: number): string {
  const d = new Date()
  d.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()) + 7 * weeks)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function auth(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { headers: { Authorization: `Bearer ${token}` }, userId }
}

async function openBlankWeek(page: Page, weekStart: string) {
  await page.goto(`/menu?week=${weekStart}`)
  await expect(page.getByRole('button', { name: 'Generar mi menú' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('week-plan-questions')).toBeVisible()
}

test('skipping the questions generates the week as always', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const weekStart = mondayIn(1)
  await openBlankWeek(page, weekStart)

  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith('/menu/generate') && r.method() === 'POST' && !r.postDataJSON()?.empty),
    page.getByRole('button', { name: 'Generar mi menú' }).click(),
  ])
  expect(req.postDataJSON().weekPlan).toBeUndefined()
  await expect(page.getByRole('button', { name: 'Generar mi menú' })).toHaveCount(0, { timeout: 30_000 })
})

test('answering them: no Thursday dinner, 6 on Tuesday, plantilla untouched', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const { headers, userId } = await auth(page)
  const settingsBefore = await (await page.request.get(`${API}/user/${userId}/settings`, { headers })).text()
  const weekStart = mondayIn(2)
  await openBlankWeek(page, weekStart)

  await page.getByRole('button', { name: /¿Alguna comida fuera de casa\?/ }).click()
  await page.getByRole('button', { name: 'Jue · Cena fuera' }).click()
  await expect(page.getByRole('button', { name: 'Jue · Cena fuera' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: /¿Viene alguien\?/ }).click()
  await page.getByRole('group', { name: 'Días con invitados' }).getByRole('button', { name: 'Mar', exact: true }).click()
  const count = page.getByTestId('guests-1')
  const plus = page.getByRole('button', { name: 'Uno más el Mar' })
  for (let i = 0; i < 24 && (await count.textContent()) !== '6'; i++) {
    const n = Number(await count.textContent())
    await (n < 6 ? plus : page.getByRole('button', { name: 'Uno menos el Mar' })).click()
  }
  await expect(count).toHaveText('6')

  // PRO-229: what's left in the fridge, in the same step.
  await page.getByRole('button', { name: '¿Qué te queda en la nevera?' }).click()
  await page.getByLabel('Lo que queda en la nevera').fill('medio calabacín, nata')

  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/menu/generate') && r.request().method() === 'POST' && !!r.request().postDataJSON()?.weekPlan),
    page.getByRole('button', { name: 'Generar mi menú' }).click(),
  ])
  expect(res.request().postDataJSON().weekPlan).toEqual({
    mealsOut: [{ day: 3, meal: 'dinner' }],
    guests: [{ day: 1, diners: 6 }],
    fridgeText: 'medio calabacín, nata',
  })
  expect(res.status()).toBe(201)
  const menu = await res.json()
  expect(menu.days[3].dinner).toBeUndefined()
  expect(menu.days[1].lunch?.servings).toBe(6)
  expect(menu.days[1].dinner?.servings).toBe(6)

  const fridge = await (await page.request.get(`${API}/pantry?location=nevera`, { headers })).json()
  // PRO-295: read into foods linked to the catalogue (by Claude, or by the
  // catalogue alone when there's no model), not the words as typed.
  const names = fridge.map((r: { name: string }) => r.name.toLowerCase()).join(' | ')
  expect(names).toMatch(/calabac/)
  expect(fridge.find((r: { name: string }) => /calabac/i.test(r.name))?.ingredientId).toBeTruthy()

  const settingsAfter = await (await page.request.get(`${API}/user/${userId}/settings`, { headers })).text()
  expect(settingsAfter).toBe(settingsBefore)
})

test('PRO-295: an intolerance in the fridge asks before generating', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const weekStart = mondayIn(3)
  await openBlankWeek(page, weekStart)

  await page.getByRole('button', { name: '¿Qué te queda en la nevera?' }).click()
  await page.getByLabel('Lo que queda en la nevera').fill('Pues mira, dos yogures (ojo: no tomo nada de lactosa, me sienta fatal)')
  const [first] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/menu/generate') && r.request().method() === 'POST' && !!r.request().postDataJSON()?.weekPlan),
    page.getByRole('button', { name: 'Generar mi menú' }).click(),
  ])
  expect(first.status()).toBe(409)
  const question = page.getByTestId('fridge-health-question')
  await expect(question).toContainText('sin lactosa')
  await expect(page.getByRole('button', { name: 'Generar mi menú' })).toHaveCount(0)

  const [second] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/menu/generate') && r.request().method() === 'POST' && !!r.request().postDataJSON()?.weekPlan?.fridgeAnswer),
    page.getByRole('button', { name: 'No, generar sin guardarla' }).click(),
  ])
  expect(second.request().postDataJSON().weekPlan.fridgeAnswer).toEqual({ decision: 'skip' })
  expect(second.status()).toBe(201)
  await expect(question).toHaveCount(0, { timeout: 30_000 })
})
