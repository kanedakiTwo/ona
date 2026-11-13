/**
 * PRO-1175 · Hoja de una comida: cinco opciones y «Más opciones».
 *
 * Hecho cuando (a 390×844 y a 1440×900):
 *   - la hoja de una cena futura enseña 5 opciones, sin «Marcar como
 *     cocinada», sin «Cambiar al azar» ni «Tipo de comida»;
 *   - «Cambiar plato» → chip «Legumbres» → «Que elija Mimoia» deja en el
 *     hueco una receta de legumbres (el PUT lleva `dishType`);
 *   - «Más opciones» → Comensales 4 deja «Solo hoy: 4».
 *
 * La cena es la del sábado de la semana que viene: futura a cualquier hora y
 * sin el tope de 30 minutos de lunes a viernes, que dejaría fuera las
 * legumbres del catálogo de prueba (Lentejas guisadas, 60 min; Falafel, 40).
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'
import { madridMondayIn } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'
const SATURDAY = 5

async function futureDinner(page: Page) {
  await registerFreshUser(page)
  await completeOnboarding(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const headers = { Authorization: `Bearer ${token}` }
  const weekStart = madridMondayIn(1)
  // Una semana sin platos, para que las legumbres no estén ya puestas en otro día.
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, empty: true, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const menu = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()

  const legumes: Array<{ id: string; name: string }> = await (
    await page.request.get(`${API}/recipes?perPage=100&fitsMe=1&dishType=legumbres`, { headers })
  ).json()
  expect(legumes.length, 'el catálogo de prueba tiene legumbres').toBeGreaterThan(0)
  const all: Array<{ id: string; name: string }> = await (await page.request.get(`${API}/recipes?perPage=100&fitsMe=1`, { headers })).json()
  const other = all.find((r) => !legumes.some((l) => l.id === r.id))
  expect(other, 'una receta que no es de legumbres').toBeTruthy()

  const path = `${API}/menu/${menu.id}/day/${SATURDAY}/meal/dinner`
  const put = menu.days?.[SATURDAY]?.dinner
    ? await page.request.put(path, { headers, data: { recipeId: other!.id } })
    : await page.request.post(path, { headers, data: { recipeId: other!.id } })
  expect(put.ok(), `cena del sábado: ${put.status()}`).toBeTruthy()

  const dinnerNow = async () =>
    (await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()).days?.[SATURDAY]?.dinner
  return { legumes, dinnerNow }
}

async function checkSheet(page: Page, { legumes, dinnerNow }: Awaited<ReturnType<typeof futureDinner>>) {
  // ── Cinco opciones en el primer nivel, sin «Marcar como cocinada».
  await page.getByRole('button', { name: /^Más opciones de cena/ }).first().click()
  const sheet = page.getByRole('dialog')
  const first = sheet.getByTestId('meal-sheet-first')
  await expect(first.getByRole('button').or(first.getByRole('link'))).toHaveCount(5)
  for (const name of ['Ver receta', 'Cambiar plato', 'Añadir plato', 'No la pongas más esta semana', 'Más opciones']) {
    await expect(first.getByRole(name === 'Ver receta' ? 'link' : 'button', { name, exact: true })).toBeVisible()
  }
  await expect(sheet.getByText('Marcar como cocinada')).toHaveCount(0)
  await expect(sheet.getByText('Cambiar al azar')).toHaveCount(0)
  await expect(sheet.getByText('Tipo de comida')).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: 'Quitar cena', exact: true })).toBeVisible()

  // ── «Cambiar plato» → chip «Legumbres» → «Que elija Mimoia».
  await first.getByRole('button', { name: 'Cambiar plato', exact: true }).click()
  const picker = page.getByTestId('recipe-picker')
  await expect(picker).toBeVisible()
  const chip = picker.getByRole('button', { name: 'Legumbres', exact: true })
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  // La lista solo tiene legumbres.
  const results = picker.getByTestId('picker-results').getByRole('listitem')
  await expect(results).toHaveCount(legumes.length, { timeout: 15_000 })
  const sent = page.waitForRequest((r) => r.method() === 'PUT' && /\/day\/5\/meal\/dinner$/.test(r.url()))
  await picker.getByRole('button', { name: 'Que elija Mimoia' }).click()
  expect((await sent).postDataJSON()).toEqual({ dishType: 'legumbres' })
  await expect(picker).toHaveCount(0, { timeout: 15_000 })
  await expect
    .poll(async () => {
      const id = (await dinnerNow())?.dishes?.[0]?.recipeId
      return legumes.some((l) => l.id === id)
    }, { timeout: 15_000 })
    .toBe(true)

  // ── «Más opciones» → Comensales 4 → «Solo hoy: 4».
  await page.getByRole('button', { name: /^Más opciones de cena/ }).first().click()
  await page.getByRole('dialog').getByTestId('meal-sheet-first').getByRole('button', { name: 'Más opciones', exact: true }).click()
  const more = page.getByRole('dialog')
  await expect(more.getByRole('heading', { name: 'Más opciones' })).toBeVisible()
  await expect(more.getByText('Que no cambie si rehago la semana')).toBeVisible()
  const label = more.getByTestId('diners-label')
  for (let i = 0; i < 24; i++) {
    const n = Number((await label.textContent())?.match(/\d+/)?.[0])
    if (n === 4) break
    await more.getByRole('button', { name: n < 4 ? 'Más comensales' : 'Menos comensales' }).click()
    await expect(label).not.toHaveText(`Comensales: ${n}`)
  }
  await expect(label).toHaveText('Comensales: 4')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('Solo hoy: 4').first()).toBeVisible()
  await expect.poll(async () => (await dinnerNow())?.servings, { timeout: 10_000 }).toBe(4)
}

test.describe('móvil', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('la hoja de una cena futura: 5 opciones, «Que elija Mimoia» con «Legumbres» y Comensales 4', async ({ page }) => {
    test.setTimeout(180_000)
    const setup = await futureDinner(page)
    await page.goto('/menu')
    await page.getByRole('main').getByRole('button', { name: 'Semana siguiente' }).click()
    await expect(page.getByRole('button', { name: /próxima semana · volver a hoy/i })).toBeVisible({ timeout: 20_000 })
    const strip = page.getByRole('navigation', { name: 'Días de la semana' })
    await strip.getByRole('button').nth(SATURDAY).click()
    await expect(strip.getByRole('button').nth(SATURDAY)).toHaveAttribute('aria-pressed', 'true')
    await checkSheet(page, setup)
  })
})

test.describe('escritorio', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('la hoja de una cena futura: 5 opciones, «Que elija Mimoia» con «Legumbres» y Comensales 4', async ({ page }) => {
    test.setTimeout(180_000)
    const setup = await futureDinner(page)
    await page.goto('/menu')
    await page.getByRole('main').getByRole('button', { name: 'Semana siguiente' }).first().click()
    await expect(page.getByRole('button', { name: /próxima semana · volver a hoy/i })).toBeVisible({ timeout: 20_000 })
    await page.locator(`[data-day-column="${SATURDAY}"]`).getByRole('button', { name: /ver el sábado/i }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/sábado/i)
    await checkSheet(page, setup)
  })
})
