/**
 * PRO-292: each line of /shopping is edited where it is, without opening
 * anything — − / + on the amount, the unit as a selector (a menu line goes
 * from grams to units and back: cebolla), «Quitar» with «Deshacer», and the
 * «Añadir a la lista» field on top. Everything survives a reload, and what
 * was marked bought survives the unit switch.
 */
import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'
import { listSafeDay, pinClock, pinnedDay } from './_clock'

test.use({ timezoneId: 'Europe/Madrid', viewport: { width: 390, height: 844 } })

const apiUrl = process.env.API_URL ?? 'http://localhost:8765'
const ONION = 'Cebolla'

/** This week's menu, with a dish that has onion in grams (Albóndigas en salsa española, 200 g) on a day of the list. */
async function weekWithOnion(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user'))) ?? '{}')
  const { weekStart, dayIdx } = pinnedDay()
  const headers = { Authorization: `Bearer ${token}` }
  const gen = await page.request.post(`${apiUrl}/menu/generate`, { headers, data: { userId: user.id, weekStart } })
  expect(gen.ok(), `menu/generate ${gen.status()}`).toBeTruthy()
  const menu = await (await page.request.get(`${apiUrl}/menu/${user.id}/${weekStart}`, { headers })).json()
  const found = await (await page.request.get(`${apiUrl}/recipes?search=${encodeURIComponent('Albóndigas en salsa')}`, { headers })).json()
  const list = Array.isArray(found) ? found : (found.recipes ?? found.items ?? found.data ?? [])
  const recipeId = list.find((r: { name: string }) => /alb[oó]ndigas/i.test(r.name))?.id
  expect(recipeId, 'the seed has «Albóndigas en salsa española»').toBeTruthy()
  // At dinner on a day of the list's range that the API never trims by the
  // hour: the day after the pinned one, unless that is the real «today».
  const day = listSafeDay(dayIdx)
  if (menu.days?.[day]?.dinner) await page.request.delete(`${apiUrl}/menu/${menu.id}/day/${day}/meal/dinner`, { headers })
  const add = await page.request.post(`${apiUrl}/menu/${menu.id}/day/${day}/meal/dinner`, { headers, data: { recipeId } })
  expect(add.ok(), `add dinner ${add.status()}`).toBeTruthy()
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000)
  await pinClock(page)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  await weekWithOnion(page)
})

const line = (page: Page, name: string) =>
  page.getByTestId('shopping-line').filter({ has: page.getByRole('button', { name: `Cambiar ${name}`, exact: true }) })
const amount = (page: Page, name: string) => page.getByLabel(`Cantidad de ${name}`, { exact: true })
const lineWrite = (page: Page) =>
  page.waitForResponse((r) => /\/shopping-list\/[^/]+\/item\/[^/]+(\/edit)?$/.test(new URL(r.url()).pathname) && r.request().method() !== 'GET' && r.ok())

async function openList(page: Page) {
  await page.goto('/shopping')
  await expect(line(page, ONION)).toBeVisible({ timeout: 20_000 })
}

test('− / + change the amount on the line itself, and it survives a reload', async ({ page }) => {
  await openList(page)
  const input = amount(page, ONION)
  const before = await input.inputValue()

  let saved = lineWrite(page)
  await page.getByRole('button', { name: `Más ${ONION}`, exact: true }).click()
  await saved
  const raised = await input.inputValue()
  expect(Number(raised.replace(',', '.'))).toBeGreaterThan(Number(before.replace(',', '.')))
  await expect(line(page, ONION).getByTestId('shopping-changed')).toBeVisible()

  await page.reload()
  await expect(amount(page, ONION)).toHaveValue(raised, { timeout: 20_000 })

  saved = lineWrite(page)
  await page.getByRole('button', { name: `Menos ${ONION}`, exact: true }).click()
  await saved
  await expect(amount(page, ONION)).toHaveValue(before)
  await page.reload()
  await expect(amount(page, ONION)).toHaveValue(before, { timeout: 20_000 })
  await expect(line(page, ONION).getByTestId('shopping-changed')).toHaveCount(0)
})

test('a menu line goes from grams to units and back, keeping it bought, also after a reload', async ({ page }) => {
  await openList(page)
  const unit = page.getByLabel(`Unidad de ${ONION}`, { exact: true })
  await expect(unit).toHaveValue('g')
  const grams = await amount(page, ONION).inputValue()

  // Bought first: the switch must not lose it.
  const check = line(page, ONION).getByRole('button', { name: 'Marcar como comprado' })
  const ticked = page.waitForResponse((r) => r.url().endsWith('/check') && r.ok())
  await check.click()
  await ticked
  await expect(check).toHaveAttribute('aria-pressed', 'true')

  let saved = lineWrite(page)
  await unit.selectOption('u')
  await saved
  await expect(unit).toHaveValue('u')
  expect(Number(await amount(page, ONION).inputValue())).toBeGreaterThanOrEqual(1)
  await expect(line(page, ONION).getByTestId('shopping-changed')).toContainText(`menú: ${grams} g`)

  await page.reload()
  await expect(page.getByLabel(`Unidad de ${ONION}`, { exact: true })).toHaveValue('u', { timeout: 20_000 })
  await expect(line(page, ONION).getByRole('button', { name: 'Marcar como comprado' })).toHaveAttribute('aria-pressed', 'true')

  saved = lineWrite(page)
  await page.getByLabel(`Unidad de ${ONION}`, { exact: true }).selectOption('g')
  await saved
  await page.reload()
  await expect(page.getByLabel(`Unidad de ${ONION}`, { exact: true })).toHaveValue('g', { timeout: 20_000 })
  await expect(amount(page, ONION)).toHaveValue(grams)
  await expect(line(page, ONION).getByRole('button', { name: 'Marcar como comprado' })).toHaveAttribute('aria-pressed', 'true')
})

test('«Quitar» takes a line off and «Deshacer» brings it back, also after a reload', async ({ page }) => {
  await openList(page)
  let saved = lineWrite(page)
  await page.getByRole('button', { name: `Quitar ${ONION}`, exact: true }).click()
  await saved
  await expect(line(page, ONION)).toHaveCount(0)
  const toast = page.getByTestId('shopping-undo')
  await expect(toast).toContainText(`Quitado: ${ONION}`)

  saved = lineWrite(page)
  await toast.getByRole('button', { name: 'Deshacer' }).click()
  await saved
  await expect(line(page, ONION)).toBeVisible()
  await page.reload()
  await expect(line(page, ONION)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('shopping-skipped')).toHaveCount(0)
})

test('«Añadir a la lista» on top adds a product that stays after a reload, and it can be removed and undone too', async ({ page }) => {
  await openList(page)
  const field = page.getByLabel('Añadir a la lista', { exact: true })
  await expect(field).toBeVisible()
  await field.fill('Pan de pueblo')
  await field.press('Enter')
  await expect(line(page, 'Pan de pueblo')).toBeVisible()
  await expect(field).toHaveValue('')

  await page.reload()
  await expect(line(page, 'Pan de pueblo')).toBeVisible({ timeout: 20_000 })

  // A line typed by hand: + works on it too.
  let saved = lineWrite(page)
  await page.getByRole('button', { name: 'Más Pan de pueblo', exact: true }).click()
  await saved
  await expect(amount(page, 'Pan de pueblo')).toHaveValue('2')

  saved = lineWrite(page)
  await page.getByRole('button', { name: 'Quitar Pan de pueblo', exact: true }).click()
  await saved
  await expect(line(page, 'Pan de pueblo')).toHaveCount(0)
  await page.getByTestId('shopping-undo').getByRole('button', { name: 'Deshacer' }).click()
  await expect(line(page, 'Pan de pueblo')).toBeVisible()
  await page.reload()
  await expect(amount(page, 'Pan de pueblo')).toHaveValue('2', { timeout: 20_000 })
})
