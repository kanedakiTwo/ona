/**
 * PRO-1186 · Semana tipo, fase 5: en el menú.
 *
 * Hecho cuando (a 390×844 y a 1440×900):
 *   - «Más opciones» → «Guardar en mi semana tipo» → «Otro tipo de plato» →
 *     «Legumbres» en una cena libre: la cena de esta semana pasa a ser de
 *     legumbres con el chip «Legumbres · semana tipo», y en Perfil → «Tu
 *     semana tipo» el sábado, cena, dice «Legumbres»;
 *   - mientras se genera una semana, «La semana» enseña el esqueleto con los
 *     iconos de la semana tipo y «Buscando…», y el menú lo sustituye entero.
 *
 * La cena es la del sábado de la semana que viene (como meal-sheet-options):
 * futura a cualquier hora y sin el tope de 30 minutos de lunes a viernes.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'
import { madridMondayIn } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'
const SATURDAY = 5

async function auth(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { headers: { Authorization: `Bearer ${token}` }, userId }
}

/** Next week, empty but a Saturday dinner that isn't of legumes and isn't locked. */
async function freeSaturdayDinner(page: Page) {
  await registerFreshUser(page)
  await completeOnboarding(page)
  const { headers, userId } = await auth(page)
  const weekStart = madridMondayIn(1)
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, empty: true, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const menu = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  const legumes: Array<{ id: string }> = await (await page.request.get(`${API}/recipes?perPage=100&fitsMe=1&dishType=legumbres`, { headers })).json()
  expect(legumes.length, 'el catálogo de prueba tiene legumbres').toBeGreaterThan(0)
  const all: Array<{ id: string }> = await (await page.request.get(`${API}/recipes?perPage=100&fitsMe=1`, { headers })).json()
  const other = all.find((r) => !legumes.some((l) => l.id === r.id))
  expect(other, 'una receta que no es de legumbres').toBeTruthy()
  const path = `${API}/menu/${menu.id}/day/${SATURDAY}/meal/dinner`
  const put = menu.days?.[SATURDAY]?.dinner
    ? await page.request.put(path, { headers, data: { recipeId: other!.id } })
    : await page.request.post(path, { headers, data: { recipeId: other!.id } })
  expect(put.ok(), `cena del sábado: ${put.status()}`).toBeTruthy()
  // Elegida a mano queda fijada (PRO-1175): se suelta, como una que hubiera puesto Mimoia.
  const unlock = await page.request.put(`${path}/lock`, { headers, data: { locked: false } })
  expect(unlock.ok(), `soltar: ${unlock.status()}`).toBeTruthy()
  const dinnerNow = async () => (await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()).days?.[SATURDAY]?.dinner
  return { legumes, dinnerNow }
}

async function saveLegumes(page: Page, { legumes, dinnerNow }: Awaited<ReturnType<typeof freeSaturdayDinner>>) {
  await page.getByRole('button', { name: /^Más opciones de cena/ }).first().click()
  await page.getByRole('dialog').getByTestId('meal-sheet-first').getByRole('button', { name: 'Más opciones', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar en mi semana tipo' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('heading', { name: 'Guardar en mi semana tipo' })).toBeVisible()
  await expect(sheet.getByText('Los sábados, cena: todas las semanas.')).toBeVisible()
  await sheet.getByRole('button', { name: 'Otro tipo de plato' }).click()
  const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/day\/5\/meal\/dinner\/week-type$/.test(r.url()))
  await sheet.getByTestId('week-type-all-types').getByRole('button', { name: 'Legumbres', exact: true }).click()
  expect((await sent).postDataJSON()).toEqual({ option: { kind: 'type', type: 'legumbres' } })

  // Se guarda y la cena de esta semana pasa a ser de legumbres, con su chip.
  await expect(page.getByTestId('menu-notice')).toHaveText('Guardado en tu semana tipo: los sábados, cena, «Legumbres».', { timeout: 20_000 })
  await expect(page.getByTestId('week-type-chip').first()).toHaveText(/Legumbres · semana tipo/, { timeout: 15_000 })
  await expect
    .poll(async () => {
      const dish = (await dinnerNow())?.dishes?.[0]
      return legumes.some((l) => l.id === dish?.recipeId) && dish?.fromWeekType?.type === 'legumbres'
    }, { timeout: 15_000 })
    .toBe(true)

  // Y en «Tu semana tipo»: el sábado, cena, dice «Legumbres».
  await page.goto('/profile/semana-tipo')
  await expect(page.getByTestId(`wt-cell-${SATURDAY}-dinner`)).toHaveAttribute('aria-label', 'Sábado, cena: Legumbres', { timeout: 20_000 })
}

/** A blank week: «Llenar con mi semana tipo» shows the skeleton until the menu arrives. */
async function checkSkeleton(page: Page) {
  const weekStart = madridMondayIn(2)
  await page.goto(`/menu?week=${weekStart}`)
  const fill = page.getByRole('button', { name: 'Llenar con mi semana tipo' })
  await expect(fill).toBeVisible({ timeout: 20_000 })
  // The generation is held until the skeleton has been seen.
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  await page.route('**/menu/generate', async (route) => {
    if (route.request().method() === 'POST' && !route.request().postDataJSON()?.empty) await held
    await route.continue()
  })
  await fill.click()
  const skeleton = page.getByTestId('week-type-skeleton')
  await expect(skeleton).toBeVisible()
  await expect(skeleton).toContainText('Buscando…')
  // The week type of the household, one cell per slot (the sábado's cena now asks for legumbres).
  await expect(skeleton.getByTestId(`wt-cell-${SATURDAY}-dinner`)).toContainText('Legumbres')
  await expect(skeleton.getByTestId('wt-cell-0-lunch')).toBeVisible()
  release()
  await expect(skeleton).toHaveCount(0, { timeout: 60_000 })
  await expect(fill).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Más opciones de/ }).first()).toBeVisible({ timeout: 20_000 })
}

test.describe('móvil', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('«Guardar en mi semana tipo» en una cena: legumbres esta semana y todas, y el esqueleto al llenar otra semana', async ({ page }) => {
    test.setTimeout(240_000)
    const setup = await freeSaturdayDinner(page)
    await page.goto('/menu')
    await page.getByRole('main').getByRole('button', { name: 'Semana siguiente' }).click()
    await expect(page.getByRole('button', { name: /próxima semana · volver a hoy/i })).toBeVisible({ timeout: 20_000 })
    const strip = page.getByRole('navigation', { name: 'Días de la semana' })
    await strip.getByRole('button').nth(SATURDAY).click()
    await expect(strip.getByRole('button').nth(SATURDAY)).toHaveAttribute('aria-pressed', 'true')
    await saveLegumes(page, setup)
    await checkSkeleton(page)
  })
})

test.describe('escritorio', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('«Guardar en mi semana tipo» en una cena: legumbres esta semana y todas, y el esqueleto al llenar otra semana', async ({ page }) => {
    test.setTimeout(240_000)
    const setup = await freeSaturdayDinner(page)
    await page.goto('/menu')
    await page.getByRole('main').getByRole('button', { name: 'Semana siguiente' }).first().click()
    await expect(page.getByRole('button', { name: /próxima semana · volver a hoy/i })).toBeVisible({ timeout: 20_000 })
    await page.locator(`[data-day-column="${SATURDAY}"]`).getByRole('button', { name: /ver el sábado/i }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/sábado/i)
    await saveLegumes(page, setup)
    await checkSkeleton(page)
  })
})
