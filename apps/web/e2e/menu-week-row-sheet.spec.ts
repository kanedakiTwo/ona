/**
 * PRO-1178 · La vista semana abre la misma hoja que la vista día.
 *
 * Hecho cuando (a 390×844 en la vista semana y a 1440×900 en «La semana»):
 *   - el «···» de la cena del martes abre «Cena · martes» con las mismas
 *     opciones que en la vista día (y ya no «Aleatorio», «Bloquear» ni
 *     «Quitar slot»; en «Más opciones», Comensales y la semana tipo), y la
 *     fila enseña la etiqueta de la semana tipo;
 *   - una fila vacía y una que el día no tiene abren «Sin plato todavía»;
 *   - arrastrar una fila a otra sigue cambiando los dos huecos, y tocar el
 *     plato abre la receta con las raciones de la tanda.
 *
 * Es la semana que viene: el martes es futuro a cualquier hora, y la vista
 * semana no se va sola a hoy.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'
import { madridMondayIn } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'
const MONDAY = 0
const TUESDAY = 1
const WEDNESDAY = 2

/** A new household with next week's Tuesday lunch and dinner, two different recipes. */
async function tuesdayMeals(page: Page) {
  await registerFreshUser(page)
  await completeOnboarding(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const headers = { Authorization: `Bearer ${token}` }
  const weekStart = madridMondayIn(1)
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, empty: true, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const menu = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  const all: Array<{ id: string; name: string }> = await (await page.request.get(`${API}/recipes?perPage=100&fitsMe=1`, { headers })).json()
  expect(all.length, 'el catálogo de prueba tiene dos recetas').toBeGreaterThan(1)
  const [lunch, dinner] = all
  for (const [meal, recipe] of [['lunch', lunch], ['dinner', dinner]] as const) {
    const path = `${API}/menu/${menu.id}/day/${TUESDAY}/meal/${meal}`
    const r = menu.days?.[TUESDAY]?.[meal]
      ? await page.request.put(path, { headers, data: { recipeId: recipe.id } })
      : await page.request.post(path, { headers, data: { recipeId: recipe.id } })
    expect(r.ok(), `martes ${meal}: ${r.status()}`).toBeTruthy()
  }
  // The dinner's own dish type into the week type: it stays, with its chip («… · semana tipo»).
  const filled = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  const type = filled.days[TUESDAY].dinner.dishes[0].dishTypes?.[0]
  expect(type, 'la cena tiene un tipo de plato').toBeTruthy()
  const saved = await page.request.post(`${API}/menu/${menu.id}/day/${TUESDAY}/meal/dinner/week-type`, { headers, data: { option: { kind: 'type', type } } })
  expect((await saved.json()).weekTypeApplied).toBe('mark')
  // Wednesday without dinner: its row is «no hay» (Monday's stay empty).
  const del = await page.request.delete(`${API}/menu/${menu.id}/day/${WEDNESDAY}/meal/dinner`, { headers })
  expect(del.ok(), `quitar la cena del miércoles: ${del.status()}`).toBeTruthy()
  const tuesdayNow = async () => {
    const day = (await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()).days?.[TUESDAY]
    return { lunch: day?.lunch?.dishes?.[0]?.recipeId, dinner: day?.dinner?.dishes?.[0]?.recipeId }
  }
  return { lunch, dinner, tuesdayNow }
}

/** The options of the open meal sheet, by their label (the hint is the description). */
async function sheetOptions(page: Page): Promise<string[]> {
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByTestId('meal-sheet-first')).toBeVisible()
  return sheet.locator('[aria-labelledby]').evaluateAll((els) =>
    els.map((el) => document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent?.trim() ?? ''),
  )
}

/** «Cena · martes 24», the dinner's name as the title, and what was missing from the old row menu. */
async function checkDinnerSheet(page: Page, dinnerName: string): Promise<string[]> {
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText(/Cena · martes \d+/)
  await expect(sheet.getByRole('heading', { name: dinnerName })).toBeVisible()
  const options = await sheetOptions(page)
  for (const name of ['Ver receta', 'Cambiar plato', 'Añadir plato', 'No la pongas más esta semana', 'Más opciones', 'Quitar cena']) {
    expect(options, name).toContain(name)
  }
  for (const old of ['Aleatorio', 'Bloquear', 'Desbloquear', 'Quitar slot', 'Vetar receta']) expect(options, old).not.toContain(old)
  // «Más opciones»: Comensales y la semana tipo, que el menú de la fila no tenía.
  await sheet.getByTestId('meal-sheet-first').getByRole('button', { name: 'Más opciones', exact: true }).click()
  const more = page.getByRole('dialog').getByTestId('meal-sheet-more')
  await expect(more.getByTestId('diners-label')).toBeVisible()
  await expect(more.getByRole('button', { name: 'Guardar en mi semana tipo', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  return options
}

/** Mouse drag past dnd-kit's 8 px activation, from `source` onto `target`. */
async function dragTo(page: Page, source: Locator, target: Locator) {
  await source.scrollIntoViewIfNeeded()
  const s = (await source.boundingBox())!
  const t = (await target.boundingBox())!
  await page.mouse.move(s.x + s.width / 2, s.y + Math.min(30, s.height / 2))
  await page.mouse.down()
  await page.mouse.move(s.x + s.width / 2 + 10, s.y + Math.min(30, s.height / 2) + 12, { steps: 5 })
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 })
  await page.mouse.up()
}

async function dragLunchOntoDinner(page: Page, source: Locator, target: Locator, setup: Awaited<ReturnType<typeof tuesdayMeals>>) {
  const moved = page.waitForResponse((r) => r.url().endsWith('/move-slot') && r.request().method() === 'POST')
  await dragTo(page, source, target)
  const res = await moved
  expect(res.ok(), `move-slot: ${res.status()}`).toBeTruthy()
  expect(JSON.parse(res.request().postData() ?? '{}')).toMatchObject({ fromDay: TUESDAY, fromMeal: 'lunch', toDay: TUESDAY, toMeal: 'dinner' })
  // Los dos huecos cambian: la comida pasa a la cena y la cena a la comida.
  await expect.poll(setup.tuesdayNow, { timeout: 10_000 }).toEqual({ lunch: setup.dinner.id, dinner: setup.lunch.id })
}

async function toNextWeek(page: Page) {
  await page.goto('/menu')
  await page.getByRole('main').getByRole('button', { name: 'Semana siguiente' }).first().click()
  await expect(page.getByRole('button', { name: /próxima semana · volver a hoy/i })).toBeVisible({ timeout: 20_000 })
}

test.describe('móvil · vista semana', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('el «···» de la cena del martes abre la hoja de la vista día; arrastrar una fila cambia los dos huecos', async ({ page }) => {
    test.setTimeout(180_000)
    const setup = await tuesdayMeals(page)
    await toNextWeek(page)
    await page.getByRole('button', { name: 'Opciones de la semana' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Vista semana', exact: true }).click()
    const dinnerRow = page.locator(`[data-week-row="${TUESDAY}-dinner"]`)
    await expect(dinnerRow).toContainText(/\S/, { timeout: 20_000 })
    // La etiqueta de la semana tipo, que la fila no enseñaba.
    await expect(dinnerRow.getByTestId('week-row-week-type')).toHaveText(/· semana tipo$/)

    // ── El «···» de la fila: la hoja de la vista día.
    await dinnerRow.getByRole('button', { name: 'Más opciones de cena del martes', exact: true }).click()
    const fromWeek = await checkDinnerSheet(page, setup.dinner.name)

    // ── Una fila vacía y una que el día no tiene: «Sin plato todavía», como en la vista día.
    await page.locator(`[data-week-row="${MONDAY}-lunch"]`).click()
    let sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: 'Sin plato todavía' })).toBeVisible()
    await expect(sheet).toContainText(/Comida · lunes/)
    await expect(sheet.getByRole('button', { name: 'Quitar comida de este día', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.locator(`[data-week-row="${WEDNESDAY}-dinner"]`).click()
    sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: 'Sin plato todavía' })).toBeVisible()
    await expect(sheet).toContainText(/Cena · miércoles/)
    await expect(sheet.getByRole('button', { name: 'Escribir un plato', exact: true })).toBeVisible()
    await expect(sheet.getByRole('button', { name: /^Quitar/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // ── La misma cena en la vista día: las mismas opciones.
    await page.getByRole('button', { name: /^Ir al día Martes/ }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/martes/i)
    await page.getByRole('button', { name: 'Más opciones de cena', exact: true }).click()
    expect(await checkDinnerSheet(page, setup.dinner.name)).toEqual(fromWeek)

    // ── Arrastrar la comida sobre la cena sigue cambiando los dos huecos.
    await page.getByRole('button', { name: 'Opciones de la semana' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Vista semana', exact: true }).click()
    const lunchRow = page.locator(`[data-week-row="${TUESDAY}-lunch"]`)
    await expect(lunchRow).toBeVisible({ timeout: 20_000 })
    // The mouse doesn't wait: the week sheet's backdrop, still leaving, would take the press.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await dragLunchOntoDinner(page, lunchRow, page.locator(`[data-week-row="${TUESDAY}-dinner"]`), setup)
    await expect(page.locator(`[data-week-row="${TUESDAY}-dinner"]`).getByRole('button', { name: 'Más opciones de cena del martes', exact: true })).toBeVisible()

    // ── Tocar el plato abre su receta con las raciones de la tanda, como desde la vista día.
    await page.locator(`[data-week-row="${TUESDAY}-dinner"]`).locator(`button[title="${setup.lunch.name}"]`).click()
    await page.waitForURL(new RegExp(`/recipes/${setup.lunch.id}\\?servings=\\d+`), { timeout: 20_000 })
  })
})

test.describe('escritorio · La semana', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('el «···» de la cena del martes abre la hoja de la vista día; arrastrar un plato cambia los dos huecos', async ({ page }) => {
    test.setTimeout(180_000)
    const setup = await tuesdayMeals(page)
    await toNextWeek(page)

    // ── El «···» de la celda de «La semana».
    const dinnerCell = page.locator(`[data-week-cell="${TUESDAY}-dinner"]`)
    await dinnerCell.scrollIntoViewIfNeeded()
    await dinnerCell.hover()
    await dinnerCell.getByRole('button', { name: 'Más opciones de cena del martes', exact: true }).click()
    const fromWeek = await checkDinnerSheet(page, setup.dinner.name)

    // ── La misma cena arriba, en el día: las mismas opciones.
    await page.locator(`[data-day-column="${TUESDAY}"]`).getByRole('button', { name: /ver el martes/i }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/martes/i)
    await page.getByRole('button', { name: 'Más opciones de cena', exact: true }).click()
    expect(await checkDinnerSheet(page, setup.dinner.name)).toEqual(fromWeek)

    // ── Arrastrar la comida sobre la cena en «La semana».
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByTestId('week-columns').evaluate((el) => el.scrollIntoView({ block: 'center' }))
    const dish = (meal: string) => page.locator(`[data-week-cell="${TUESDAY}-${meal}"] [aria-roledescription="plato arrastrable"]`)
    await dragLunchOntoDinner(page, dish('lunch'), dish('dinner'), setup)
  })
})
