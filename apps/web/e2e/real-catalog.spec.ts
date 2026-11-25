/**
 * PRO-397 · La semana con el catálogo real (la copia de staging, no la
 * semilla de ~170 recetas; `_realCatalog.ts`).
 *
 * Los caminos de la semana: generar el menú, cambiar un plato («Que elija
 * Mimoia»), elegir otra receta en el selector y la lista de la compra. Corre
 * en tres proyectos (playwright.config.ts): móvil, escritorio (1280×800) y la
 * app instalada (`display-mode: standalone`).
 *
 * El 3-nov «Elegir otra receta» cargaba solo las 100 primeras recetas de 389
 * y no encontraba las últimas: aquí el selector tiene que encontrar la
 * receta que la API lista en último lugar. Si vuelve a cargar menos recetas
 * de las que hay, este test falla.
 */
import type { Page } from '@playwright/test'
import { test, expect } from './_realCatalog'
import { completeOnboarding, registerFreshUser } from './_helpers'
import { madridMondayIn, madridWeekStart } from './_clock'

const SATURDAY = 5
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

type Menu = { id: string; days: Array<Record<string, { dishes?: Array<{ recipeId: string | null }> } | null>> }

/** La cena del sábado de la semana que viene, en móvil o en escritorio. */
async function openSaturday(page: Page, desktop: boolean) {
  await page.goto('/menu')
  await page.getByRole('main').getByRole('button', { name: 'Semana siguiente' }).first().click()
  await expect(page.getByRole('button', { name: /próxima semana · volver a hoy/i })).toBeVisible({ timeout: 20_000 })
  if (desktop) {
    await page.locator(`[data-day-column="${SATURDAY}"]`).getByRole('button', { name: /ver el sábado/i }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/sábado/i)
  } else {
    const strip = page.getByRole('navigation', { name: 'Días de la semana' })
    await strip.getByRole('button').nth(SATURDAY).click()
    await expect(strip.getByRole('button').nth(SATURDAY)).toHaveAttribute('aria-pressed', 'true')
  }
}

async function openPicker(page: Page) {
  await page.getByRole('button', { name: /^Más opciones de cena/ }).first().click()
  await page.getByRole('dialog').getByTestId('meal-sheet-first').getByRole('button', { name: 'Cambiar plato', exact: true }).click()
  const picker = page.getByTestId('recipe-picker')
  await expect(picker).toBeVisible()
  return picker
}

test('la semana con el catálogo real: generar, cambiar un plato, elegir otra receta y la lista', async ({
  page,
  catalogApi: API,
  realCatalog,
  displayMode,
}, testInfo) => {
  test.setTimeout(300_000)
  // El catálogo real: más de una página del selector (100), como en producción.
  expect(realCatalog!.recipes, 'recetas en la copia del catálogo').toBeGreaterThan(300)
  const desktop = (testInfo.project.use.viewport?.width ?? 0) >= 1024

  const opened: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/usage/app-opened')) opened.push(r.url())
  })
  await registerFreshUser(page)
  await completeOnboarding(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const headers = { Authorization: `Bearer ${token}` }
  const getMenu = async (weekStart: string): Promise<Menu> =>
    (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()

  // ── Generar: esta semana (la lista) y la siguiente (las hojas, sin el tope de 30 min).
  const thisWeek = madridWeekStart()
  const nextWeek = madridMondayIn(1)
  for (const weekStart of [thisWeek, nextWeek]) {
    const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
    expect(gen.ok(), `generate ${weekStart}: ${gen.status()} ${await gen.text()}`).toBeTruthy()
  }
  const next = await getMenu(nextWeek)
  const filled = next.days.flatMap((d) => Object.values(d ?? {})).filter((m) => m?.dishes?.some((x) => x.recipeId)).length
  // Con el catálogo real se llena la semana (comida y cena), fin de semana incluido.
  expect(filled, 'comidas con plato la semana que viene').toBeGreaterThanOrEqual(12)
  const dinnerNow = async () => (await getMenu(nextWeek)).days?.[SATURDAY]?.dinner?.dishes?.[0]?.recipeId ?? null
  const first = await dinnerNow()
  expect(first, 'el sábado hay cena').toBeTruthy()

  // La que la API da en último lugar: fuera de la primera página del selector.
  const fits = await page.request.get(`${API}/recipes?perPage=100&fitsMe=1`, { headers })
  const total = Number(fits.headers()['x-total-count'])
  expect(total, 'recetas que le encajan').toBeGreaterThan(100)
  const lastPage = Math.ceil(total / 100)
  const tail: Array<{ id: string; name: string }> = await (
    await page.request.get(`${API}/recipes?perPage=100&fitsMe=1&page=${lastPage}`, { headers })
  ).json()
  const target = tail[tail.length - 1]
  expect(target, 'la última receta del catálogo').toBeTruthy()

  // ── Cambiar un plato: «Que elija Mimoia».
  await openSaturday(page, desktop)
  let picker = await openPicker(page)
  const rows = picker.getByTestId('picker-results').getByRole('listitem')
  await expect(rows).toHaveCount(100, { timeout: 20_000 })
  await picker.getByRole('button', { name: 'Que elija Mimoia' }).click()
  await expect(picker).toHaveCount(0, { timeout: 20_000 })
  await expect.poll(dinnerNow, { timeout: 20_000 }).not.toBe(first)

  // ── Elegir otra receta: la última del catálogo, buscándola.
  picker = await openPicker(page)
  await picker.getByPlaceholder('Buscar receta…').fill(target.name)
  await picker
    .getByTestId('picker-results')
    .getByRole('button', { name: new RegExp(`^${escape(target.name)}`) })
    .first()
    .click({ timeout: 20_000 })
  await expect(picker).toHaveCount(0, { timeout: 20_000 })
  await expect.poll(dinnerNow, { timeout: 20_000 }).toBe(target.id)
  await expect(page.getByRole('main').getByText(target.name).first()).toBeVisible({ timeout: 20_000 })

  // ── La lista de la compra de esta semana.
  await page.goto('/shopping')
  await expect
    .poll(async () => Number(await page.getByTestId('shopping-total').textContent({ timeout: 20_000 })), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(15)

  // La app instalada avisa de que se ha abierto (PRO-83); una pestaña, nunca.
  if (displayMode === 'standalone') expect(opened.length, 'POST /usage/app-opened').toBeGreaterThan(0)
  else expect(opened).toHaveLength(0)
})
