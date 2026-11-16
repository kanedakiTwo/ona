/**
 * PRO-1204 · La semana tipo, con más peso (a 390×844):
 *   - el perfil abre con «Vuestra semana»: la cuadrícula por defecto y «Así
 *     come Mimoia por defecto», y, con la semana contada, cada hueco en corto
 *     («Legum.», «Fuera»);
 *   - en el menú, cada día dice lo que pide su semana tipo («Según tu semana:
 *     legumbres y cena fuera») y lleva a ese día de «Tu semana tipo».
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'
import { madridMondayIn } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'
const MONDAY = 0

async function auth(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { headers: { Authorization: `Bearer ${token}` }, userId }
}

test.use({ viewport: { width: 390, height: 844 } })

test('el perfil abre con la semana tipo y el menú dice la de cada día', async ({ page }) => {
  test.setTimeout(180_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const { headers, userId } = await auth(page)

  // Sin tocarla: la de por defecto.
  await page.goto('/profile')
  const head = page.getByTestId('week-type-head')
  await expect(head.getByRole('heading', { name: 'Vuestra semana' })).toBeVisible({ timeout: 20_000 })
  await expect(head.getByTestId('week-type-head-grid')).toBeVisible()
  await expect(head.getByTestId(`wt-head-${MONDAY}-lunch`)).toHaveText('Libre')
  await expect(head.getByTestId('week-type-head-note')).toHaveText('Así come Mimoia por defecto: cuéntale la tuya.')
  await expect(head.getByRole('button', { name: 'Ajustar con Mimo' })).toBeVisible()
  // Arriba del todo: antes de «Quién come» (PRO-1202).
  const headTop = (await head.boundingBox())!.y
  const hubTop = (await page.getByTestId('who-eats').boundingBox())!.y
  expect(headTop).toBeLessThan(hubTop)

  // Los lunes, legumbres a mediodía y la cena fuera.
  for (const [meal, slot] of [['lunch', { options: [{ kind: 'type', type: 'legumbres' }] }], ['dinner', { off: true }]] as const) {
    const put = await page.request.put(`${API}/households/me/week-type/${MONDAY}/${meal}`, { headers, data: slot })
    expect(put.ok(), `semana tipo ${meal}: ${put.status()}`).toBeTruthy()
  }
  await page.reload()
  await expect(head.getByTestId(`wt-head-${MONDAY}-lunch`)).toHaveText('Legum.', { timeout: 20_000 })
  await expect(head.getByTestId(`wt-head-${MONDAY}-lunch`)).toHaveAttribute('data-kind', 'legumbre')
  await expect(head.getByTestId(`wt-head-${MONDAY}-dinner`)).toHaveText('Fuera')
  await expect(head.getByTestId('week-type-head-note')).not.toContainText('por defecto')

  // En el menú de la semana que viene, el lunes.
  const weekStart = madridMondayIn(1)
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, empty: true, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  // Un plato el martes, para que no sea una semana en blanco.
  const menu = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  const recipes: Array<{ id: string }> = await (await page.request.get(`${API}/recipes?perPage=5&fitsMe=1`, { headers })).json()
  const path = `${API}/menu/${menu.id}/day/1/meal/dinner`
  const add = menu.days?.[1]?.dinner
    ? await page.request.put(path, { headers, data: { recipeId: recipes[0].id } })
    : await page.request.post(path, { headers, data: { recipeId: recipes[0].id } })
  expect(add.ok(), `cena del martes: ${add.status()}`).toBeTruthy()
  await page.goto('/menu')
  await page.getByRole('main').getByRole('button', { name: 'Semana siguiente' }).click()
  await expect(page.getByRole('button', { name: /próxima semana · volver a hoy/i })).toBeVisible({ timeout: 20_000 })
  const strip = page.getByRole('navigation', { name: 'Días de la semana' })
  await strip.getByRole('button').nth(MONDAY).click()
  const line = page.getByTestId('week-type-day-line')
  await expect(line).toHaveText('Según tu semana: legumbres y cena fuera', { timeout: 20_000 })

  // Lleva a ese día de «Tu semana tipo».
  await line.click()
  await expect(page).toHaveURL(/\/profile\/semana-tipo\?dia=0$/)
  await expect(page.getByRole('rowheader', { name: 'L', exact: true })).toHaveAttribute('data-highlight', 'true', { timeout: 20_000 })
})
