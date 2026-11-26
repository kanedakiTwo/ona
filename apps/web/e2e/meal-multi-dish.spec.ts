/**
 * PRO-1176 · Comidas con varios platos: cada plato con su fila y su «···».
 *
 * Hecho cuando (a 390×844 y a 1440×900), con una comida de hoy con entrante
 * y principal:
 *   - la hoja dice «Comida · <día>» y «2 platos · N comensales»;
 *   - el «···» del segundo plato → «Cambiar este plato» → elegir una receta
 *     cambia solo el segundo;
 *   - «Ver receta» del segundo abre la suya;
 *   - arrastrar cambia el orden;
 *   - «Marcar la comida como cocinada» apunta las dos recetas y deja «✓ Comido».
 *
 * El reloj va fijado a un día de esta semana a las 12:00 (`pinClock`): la
 * comida de ese día es la de «hoy».
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'
import { pinClock } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'
const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

test.use({ timezoneId: 'Europe/Madrid' })

type Recipe = { id: string; name: string }
type Dish = { kind: 'recipe'; recipeId: string; recipeName?: string } | { kind: 'note'; text: string }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A user whose lunch today is a starter and a main. */
async function todayLunchOfTwo(page: Page) {
  const day = await pinClock(page)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const headers = { Authorization: `Bearer ${token}` }
  const { weekStart, dayIdx } = day
  // completeOnboarding leaves /menu open, and the page writes this week's
  // first menu on its own: wait for it and leave, so it can't land on top.
  await expect
    .poll(async () => (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).status(), { timeout: 30_000 })
    .toBe(200)
  await page.goto('about:blank')
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, empty: true, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const week = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  const recipes: Recipe[] = await (await page.request.get(`${API}/recipes?perPage=100&fitsMe=1`, { headers })).json()
  expect(recipes.length, 'el catálogo de prueba').toBeGreaterThan(3)
  const [starter, main, other] = recipes

  const path = `${API}/menu/${week.id}/day/${dayIdx}/meal/lunch`
  const first = week.days?.[dayIdx]?.lunch
    ? await page.request.put(path, { headers, data: { recipeId: starter.id } })
    : await page.request.post(path, { headers, data: { recipeId: starter.id } })
  expect(first.ok(), `entrante: ${first.status()}`).toBeTruthy()
  const course = await page.request.patch(`${path}/dish/0`, { headers, data: { course: 'starter' } })
  expect(course.ok(), `curso del entrante: ${course.status()}`).toBeTruthy()
  const second = await page.request.post(`${path}/dish`, { headers, data: { kind: 'recipe', recipeId: main.id, course: 'main' } })
  expect(second.ok(), `principal: ${second.status()}`).toBeTruthy()

  const lunchNow = async (): Promise<Dish[]> =>
    (await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()).days?.[dayIdx]?.lunch?.dishes ?? []
  const cooked = async (recipeId: string): Promise<number> =>
    ((await (await page.request.get(`${API}/cook-logs/recipe/${recipeId}`, { headers })).json()) as { count?: number }).count ?? 0
  expect((await lunchNow()).map((d) => (d.kind === 'recipe' ? d.recipeId : d.text))).toEqual([starter.id, main.id])
  return { dayIdx, starter, main, other, lunchNow, cooked }
}

type Setup = Awaited<ReturnType<typeof todayLunchOfTwo>>

const ids = (dishes: Dish[]) => dishes.map((d) => (d.kind === 'recipe' ? d.recipeId : d.text))

async function openLunchSheet(page: Page) {
  // The day view's lunch (hero or row), not a cell of «La semana» («… del viernes»).
  await page.getByRole('button', { name: /^Más opciones de comida($|:)/ }).first().click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByTestId('meal-dishes')).toBeVisible()
  return sheet
}

async function checkMultiDish(page: Page, { dayIdx, starter, main, other, lunchNow, cooked }: Setup) {
  // ── Title: the meal; subtitle: «2 platos · N comensales»; a row per dish.
  let sheet = await openLunchSheet(page)
  await expect(sheet.getByRole('heading', { name: new RegExp(`^Comida · ${WEEKDAYS[dayIdx]} \\d+$`) })).toBeVisible()
  await expect(sheet.getByTestId('meal-sheet-subtitle')).toHaveText(/^2 platos · \d+ comensal(es)?$/)
  await expect(sheet.getByTestId('dish-row')).toHaveCount(2)
  await expect(sheet.getByTestId('meal-dishes').getByText('Entrante')).toBeVisible()
  await expect(sheet.getByTestId('meal-dishes').getByText('Principal')).toBeVisible()
  // Nothing of one dish at the meal's level, and no random «Cambiar».
  const first = sheet.getByTestId('meal-sheet-first')
  await expect(first.getByRole('link', { name: 'Ver receta' })).toHaveCount(0)
  await expect(first.getByRole('button', { name: 'Cambiar plato' })).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: 'Cambiar', exact: true })).toHaveCount(0)
  await expect(first.getByRole('button', { name: 'Añadir plato', exact: true })).toBeVisible()
  await expect(first.getByRole('button', { name: 'Marcar la comida como cocinada', exact: true })).toBeVisible()

  // ── «Ver receta» of the second dish opens its own.
  await sheet.getByRole('button', { name: `Opciones de ${main.name}` }).click()
  let dishSheet = page.getByRole('dialog')
  await expect(dishSheet.getByRole('heading', { name: main.name })).toBeVisible()
  const options = dishSheet.getByTestId('dish-sheet')
  for (const name of ['Cambiar este plato', 'Ya está hecho / táper', 'No lo pongas más esta semana']) {
    await expect(options.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await expect(dishSheet.getByRole('button', { name: 'Quitar este plato', exact: true })).toBeVisible()
  const see = options.getByRole('link', { name: 'Ver receta' })
  await expect(see).toHaveAttribute('href', new RegExp(`/recipes/${main.id}`))
  await see.click()
  // The dev server compiles the recipe page the first time it opens.
  await expect(page).toHaveURL(new RegExp(`/recipes/${main.id}`), { timeout: 60_000 })
  await page.goBack()
  await expect(page).toHaveURL(/\/menu/)

  // ── «···» of the second → «Cambiar este plato» → a recipe: only the second changes.
  sheet = await openLunchSheet(page)
  await sheet.getByRole('button', { name: `Opciones de ${main.name}` }).click()
  dishSheet = page.getByRole('dialog')
  const sent = page.waitForRequest((r) => r.method() === 'POST' && new RegExp(`/day/${dayIdx}/meal/lunch/dish/1/regenerate$`).test(r.url()))
  await dishSheet.getByRole('button', { name: 'Cambiar este plato', exact: true }).click()
  const picker = page.getByTestId('recipe-picker')
  await expect(picker).toBeVisible()
  await picker.locator('input').fill(other.name)
  await picker.getByTestId('picker-results').getByRole('button', { name: new RegExp(`^${escape(other.name)}`) }).first().click()
  expect((await sent).postDataJSON()).toMatchObject({ recipeId: other.id })
  await expect(picker).toHaveCount(0)
  await expect.poll(async () => ids(await lunchNow()), { timeout: 15_000 }).toEqual([starter.id, other.id])

  // ── Dragging ⠿ the first dish below the second swaps them.
  sheet = await openLunchSheet(page)
  const rows = sheet.getByTestId('dish-row')
  await expect(rows.nth(1)).toContainText(other.name)
  const handle = sheet.getByRole('button', { name: `Arrastrar para ordenar: ${starter.name}` })
  const from = (await handle.boundingBox())!
  const to = (await rows.nth(1).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + ((to.y + to.height * 0.8 - from.y - from.height / 2) * i) / 12)
  }
  await page.mouse.up()
  await expect.poll(async () => ids(await lunchNow()), { timeout: 15_000 }).toEqual([other.id, starter.id])
  await expect(rows.first()).toContainText(other.name)

  // ── «Marcar la comida como cocinada»: both recipes recorded, «✓ Comido» on the card.
  const before = { starter: await cooked(starter.id), other: await cooked(other.id) }
  await sheet.getByTestId('meal-sheet-first').getByRole('button', { name: 'Marcar la comida como cocinada', exact: true }).click()
  await expect.poll(async () => [await cooked(other.id), await cooked(starter.id)], { timeout: 15_000 }).toEqual([before.other + 1, before.starter + 1])
  // «¿Qué tal?» may come up; close whatever is open.
  for (let i = 0; i < 3 && (await page.getByRole('dialog').count()) > 0; i++) await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Comido').first()).toBeVisible()
}

test.describe('móvil', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('una comida de hoy con entrante y principal: cada plato con su «···»', async ({ page }) => {
    test.setTimeout(180_000)
    const setup = await todayLunchOfTwo(page)
    await page.goto('/menu')
    await checkMultiDish(page, setup)
  })
})

test.describe('escritorio', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('una comida de hoy con entrante y principal: cada plato con su «···»', async ({ page }) => {
    test.setTimeout(180_000)
    const setup = await todayLunchOfTwo(page)
    await page.goto('/menu')
    await checkMultiDish(page, setup)
  })
})
