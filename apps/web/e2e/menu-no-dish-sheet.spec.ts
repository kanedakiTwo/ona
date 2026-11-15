/**
 * PRO-1177 · Hueco vacío y «no hay» abren la misma hoja, «Sin plato
 * todavía» (Elegir receta, Escribir un plato, Ya lo tengo hecho; el hueco
 * vacío, además, Quitar), a 390×844 (vista día) y a 1440×900 (escritorio):
 *   - «El viernes no hay cena» → «Ya lo tengo hecho» → «Congelador» → una
 *     receta deja el plato con «Del congelador · no suma a la compra» y la
 *     compra no cambia;
 *   - «Añadir comida» → Merienda abre la hoja y no añade nada hasta elegir;
 *   - «Este día no cocino» sigue pidiendo confirmación, y «Volver a cocinar
 *     este día» lo deshace.
 * Lo que pinta cada hoja lo prueba `noDishSheet.test.ts` (suite de la API).
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, menuWithRecipesOn, registerFreshUser } from './_helpers'
import { pinClock } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'
const FRI = 4

/** A fresh user whose week has a dinner every day but Friday, and a Friday lunch. */
async function weekWithoutFridayDinner(page: Page) {
  const day = await pinClock(page)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const headers = { Authorization: `Bearer ${token}` }
  const { weekStart } = day
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const slots: Array<[number, string]> = [[FRI, 'lunch'], ...[0, 1, 2, 3, 5, 6].map((d) => [d, 'dinner'] as [number, string])]
  const menu = await menuWithRecipesOn(page, headers, userId, weekStart, slots)
  if (menu.days[FRI]?.dinner) {
    const del = await page.request.delete(`${API}/menu/${menu.id}/day/${FRI}/meal/dinner`, { headers })
    expect(del.ok(), `delete Friday dinner: ${del.status()}`).toBeTruthy()
  }
  const sunday = new Date(`${weekStart}T12:00:00Z`)
  sunday.setUTCDate(sunday.getUTCDate() + 6)
  const listOf = async () =>
    ((await (await page.request.get(`${API}/shopping-list?from=${weekStart}&to=${sunday.toISOString().slice(0, 10)}`, { headers })).json()).items ?? [])
      .filter((i: { kind?: string }) => i.kind !== 'manual' && i.kind !== 'staple')
      .map((i: { name: string; quantity: number; unit: string }) => `${i.name}|${i.quantity}|${i.unit}`)
      .sort()
  const fetchMenu = async () => (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  return { menu, listOf, fetchMenu }
}

/** Every write to the week's meals (POST, PUT, PATCH, DELETE). */
function trackWrites(page: Page, menuId: string) {
  const writes: string[] = []
  page.on('request', (r) => {
    if (r.method() !== 'GET' && r.url().includes(`/menu/${menuId}/day/`)) writes.push(`${r.method()} ${r.url()}`)
  })
  return writes
}

for (const [name, viewport] of [
  ['390×844', { width: 390, height: 844 }],
  ['1440×900', { width: 1440, height: 900 }],
] as const) {
  test.describe(`«Sin plato todavía» a ${name}`, () => {
    test.use({ timezoneId: 'Europe/Madrid', viewport })

    test('«El viernes no hay cena» → «Ya lo tengo hecho» → «Congelador» → una receta: del congelador, y la compra no cambia', async ({ page }) => {
      test.setTimeout(150_000)
      const { menu, listOf, fetchMenu } = await weekWithoutFridayDinner(page)
      const before = await listOf()

      await page.goto(`/menu?day=${FRI}`)
      const absent = page.locator('[data-testid="absent-meal"][data-meal="dinner"]')
      await expect(absent).toContainText('El viernes no hay cena', { timeout: 20_000 })
      const writes = trackWrites(page, menu.id)
      await absent.getByRole('button', { name: 'Añadir cena al viernes' }).click()

      const sheet = page.getByRole('dialog', { name: 'Sin plato todavía' })
      await expect(sheet).toContainText('Cena · viernes')
      await expect(sheet.getByRole('button', { name: /^elegir receta/i })).toBeVisible()
      await expect(sheet.getByRole('button', { name: /^escribir un plato/i })).toBeVisible()
      await expect(sheet.getByRole('button', { name: /^quitar/i })).toHaveCount(0)
      await expect(sheet.getByRole('button', { name: /fijar|una al azar|del congelador|táper de la nevera/i })).toHaveCount(0)
      await expect(sheet.getByTestId('no-dish-week-type')).toHaveText('¿Todos los viernes? Ponlo en tu semana tipo')
      await sheet.getByRole('button', { name: /^ya lo tengo hecho/i }).click()

      const picker = page.getByTestId('recipe-picker')
      await expect(picker.getByText('Ya lo tengo hecho')).toBeVisible()
      await expect(picker.getByRole('button', { name: 'Nevera', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await picker.getByRole('button', { name: 'Congelador', exact: true }).click()
      await expect(picker.getByRole('button', { name: 'Congelador', exact: true })).toHaveAttribute('aria-pressed', 'true')
      expect(writes, 'nothing written before choosing').toEqual([])
      const added = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/menu/${menu.id}/day/${FRI}/meal/dinner/dish`))
      await picker.getByTestId('picker-results').getByRole('button').first().click()
      const res = await added
      expect(res.ok(), `add: ${res.status()}`).toBeTruthy()
      expect(JSON.parse(res.request().postData() ?? '{}')).toMatchObject({ kind: 'recipe', variant: 'freezer' })

      await expect(absent).toHaveCount(0, { timeout: 10_000 })
      await expect(page.getByText('Del congelador · no suma a la compra').first()).toBeVisible({ timeout: 10_000 })
      const after = await fetchMenu()
      expect(after.days[FRI].dinner.dishes[0]).toMatchObject({ kind: 'recipe', variant: 'freezer' })
      expect(await listOf()).toEqual(before)
    })

    test('«Añadir comida» → Merienda abre la hoja y no añade nada hasta elegir; «Este día no cocino» pide confirmación', async ({ page }) => {
      test.setTimeout(150_000)
      const { menu, fetchMenu } = await weekWithoutFridayDinner(page)
      expect((await fetchMenu()).days[FRI]?.snack, 'no snack on Friday').toBeFalsy()

      await page.goto(`/menu?day=${FRI}`)
      const addMeal = page.getByRole('button', { name: /^añadir comida$/i })
      await expect(addMeal).toBeVisible({ timeout: 20_000 })
      const writes = trackWrites(page, menu.id)
      await addMeal.click()
      await page.getByRole('dialog', { name: 'Añadir comida al viernes' }).getByRole('button', { name: /^merienda$/i }).click()
      const sheet = page.getByRole('dialog', { name: 'Sin plato todavía' })
      await expect(sheet).toContainText('Merienda · viernes')
      await expect(sheet.getByRole('button', { name: /^elegir receta/i })).toBeVisible()
      await expect(sheet.getByRole('button', { name: /^escribir un plato/i })).toBeVisible()
      await expect(sheet.getByRole('button', { name: /^ya lo tengo hecho/i })).toBeVisible()
      await page.waitForTimeout(500)
      expect(writes, '«Añadir comida» adds nothing by itself').toEqual([])
      await page.keyboard.press('Escape')
      await expect(sheet).toHaveCount(0)
      expect((await fetchMenu()).days[FRI]?.snack, 'still no snack').toBeFalsy()

      // «Este día no cocino» (before, «Saltar día») still asks first.
      const skip = page.getByRole('button', { name: /^este día no cocino$/i })
      await skip.click()
      const confirm = page.getByRole('dialog', { name: '¿El viernes no cocinas?' })
      await expect(confirm).toBeVisible()
      await confirm.getByRole('button', { name: /^cancelar$/i }).click()
      await expect(page.getByText('Día marcado sin cocinar.')).toHaveCount(0)
      expect(writes).toEqual([])

      await skip.click()
      await page.getByRole('dialog', { name: '¿El viernes no cocinas?' }).getByRole('button', { name: /^este día no cocino$/i }).click()
      await expect(page.getByText('Día marcado sin cocinar.')).toBeVisible({ timeout: 10_000 })
      await page.getByRole('button', { name: /^volver a cocinar este día$/i }).click()
      await expect(page.getByText('Día marcado sin cocinar.')).toHaveCount(0, { timeout: 10_000 })
    })
  })
}
