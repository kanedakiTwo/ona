/**
 * PRO-1179 · La hoja «···» de la semana: semana tipo arriba, «Rehacer la
 * semana…» al final (propuesta de Producto 2026-11-11 §1.7 y §3).
 *
 * Hecho cuando (a 390×844 y a 1440×900):
 *   - la hoja no tiene «Semana anterior» (la cabecera tiene ‹ ›);
 *   - «Rehacer la semana…» → «Con mi semana tipo» regenera y respeta un plato
 *     fijado;
 *   - «Vaciarla y rellenar a mano» pide confirmación;
 *   - en escritorio no hay «Regenerar semana» a la vista y «Semana tipo»
 *     lleva a su pantalla.
 *
 * La semana es la que viene (`?week=`): futura a cualquier hora.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'
import { madridMondayIn } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'

type Slot = { dishes?: Array<{ kind: string; recipeId?: string }> }
type Day = Record<string, Slot | undefined>
const firstRecipe = (s: Slot | undefined) => s?.dishes?.find((d) => d.kind === 'recipe' && d.recipeId)?.recipeId

/** Next week generated, with one meal picked by hand (so it's fixed): the one to keep. */
async function weekWithFixedMeal(page: Page) {
  await registerFreshUser(page)
  await completeOnboarding(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const headers = { Authorization: `Bearer ${token}` }
  const weekStart = madridMondayIn(1)

  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const menu = (await gen.json()) as { id: string; days: Day[] }
  const day = menu.days.findIndex((d) => firstRecipe(d?.lunch))
  expect(day, 'una comida con receta').toBeGreaterThanOrEqual(0)
  const current = firstRecipe(menu.days[day]!.lunch)

  const all: Array<{ id: string }> = await (await page.request.get(`${API}/recipes?perPage=100&fitsMe=1`, { headers })).json()
  const pick = all.find((r) => r.id !== current)
  expect(pick, 'otra receta del catálogo').toBeTruthy()
  const put = await page.request.put(`${API}/menu/${menu.id}/day/${day}/meal/lunch`, { headers, data: { recipeId: pick!.id } })
  expect(put.ok(), `elegir a mano: ${put.status()}`).toBeTruthy()
  return { weekStart, day, fixed: pick!.id }
}

async function openWeekSheet(page: Page, weekStart: string) {
  await page.goto(`/menu?week=${weekStart}`)
  await page.getByRole('button', { name: 'Opciones de la semana' }).click()
  return page.getByRole('dialog')
}

for (const [label, viewport] of [
  ['móvil', { width: 390, height: 844 }],
  ['escritorio', { width: 1440, height: 900 }],
] as const) {
  test.describe(`${label} (${viewport.width}×${viewport.height})`, () => {
    test.use(viewport.width > 1000 ? { viewport, isMobile: false, hasTouch: false } : { viewport })

    test('la hoja no navega; «Rehacer la semana…» → «Con mi semana tipo» respeta lo fijado; «Vaciarla» pide confirmación', async ({ page }) => {
      test.setTimeout(180_000)
      const { weekStart, day, fixed } = await weekWithFixedMeal(page)

      const sheet = await openWeekSheet(page, weekStart)
      await expect(sheet.getByTestId('week-sheet')).toBeVisible({ timeout: 20_000 })
      await expect(sheet.getByRole('button', { name: 'Semana anterior' })).toHaveCount(0)
      await expect(sheet.getByRole('button', { name: 'Semana siguiente' })).toHaveCount(0)
      await expect(sheet.getByText('Volver a esta semana')).toHaveCount(0)
      if (viewport.width < 1000) {
        // Arriba, «Tu semana tipo»; al final, «Rehacer la semana…».
        const options = sheet.getByTestId('week-sheet').locator(':scope a, :scope button')
        await expect(options.first()).toHaveAccessibleName('Tu semana tipo')
        await expect(options.last()).toHaveAccessibleName('Rehacer la semana…')
      }

      await sheet.getByRole('button', { name: 'Rehacer la semana…' }).click()
      const redo = page.getByTestId('week-redo-sheet')
      await expect(redo).toBeVisible()
      const generated = page.waitForResponse((r) => r.url().endsWith('/menu/generate') && r.request().method() === 'POST')
      await redo.getByRole('button', { name: 'Con mi semana tipo' }).click()
      const res = await generated
      expect(res.status()).toBe(201)
      const body = (await res.json()) as { days: Day[] }
      expect(firstRecipe(body.days[day]?.lunch), 'la comida fijada se queda').toBe(fixed)

      // «Vaciarla y rellenar a mano» pregunta antes; «Cancelar» no borra nada.
      await page.getByRole('button', { name: 'Opciones de la semana' }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Rehacer la semana…' }).click()
      let cleared = false
      page.on('request', (r) => {
        if (r.url().endsWith('/menu/generate') && r.method() === 'POST') cleared = true
      })
      await page.getByTestId('week-redo-sheet').getByRole('button', { name: 'Vaciarla y rellenar a mano' }).click()
      const confirm = page.getByRole('dialog').filter({ hasText: '¿Vaciar esta semana?' })
      await expect(confirm).toBeVisible()
      await confirm.getByRole('button', { name: 'Cancelar' }).click()
      await expect(confirm).toHaveCount(0)
      expect(cleared).toBe(false)
    })
  })
}

test.describe('escritorio (1440×900): cabecera', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('sin «Regenerar semana» a la vista; «Semana tipo» lleva a su pantalla', async ({ page }) => {
    test.setTimeout(120_000)
    await registerFreshUser(page)
    await completeOnboarding(page)
    await page.goto('/menu')
    const weekType = page.getByRole('link', { name: 'Semana tipo' })
    await expect(weekType).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: /regenerar semana/i })).toHaveCount(0)
    await weekType.click()
    await page.waitForURL(/\/profile\/semana-tipo$/, { timeout: 20_000 })
  })
})
