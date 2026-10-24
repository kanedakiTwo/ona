/**
 * PRO-293: «Habitual» on a line of /shopping. A product added by hand and a
 * menu line (cebolla) are marked habitual with their star; the list of the
 * week after (no menu there) brings both by themselves; switching one off
 * pauses it and it no longer comes.
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
const star = (page: Page, name: string) => page.getByRole('button', { name: `Habitual: ${name}`, exact: true })
const habitualWrite = (page: Page) => page.waitForResponse((r) => r.url().endsWith('/edit') && r.request().method() === 'PUT' && r.ok())

test('a manual product and a menu line marked habitual come back on next week\'s list; switched off, it stops', async ({ page }) => {
  const COOKIES = 'Galletas María'
  await page.goto('/shopping')
  await expect(line(page, ONION)).toBeVisible({ timeout: 20_000 })

  const field = page.getByLabel('Añadir a la lista', { exact: true })
  await field.fill(COOKIES)
  await field.press('Enter')
  await expect(line(page, COOKIES)).toBeVisible()

  let saved = habitualWrite(page)
  await star(page, COOKIES).click()
  await saved
  await expect(star(page, COOKIES)).toHaveAttribute('aria-pressed', 'true')
  await expect(line(page, COOKIES).getByTestId('shopping-habitual')).toBeVisible()

  saved = habitualWrite(page)
  await star(page, ONION).click()
  await saved
  await expect(star(page, ONION)).toHaveAttribute('aria-pressed', 'true')

  await page.reload()
  await expect(star(page, ONION)).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 })
  await expect(star(page, COOKIES)).toHaveAttribute('aria-pressed', 'true')

  // The week after: no menu there, the two habituals come by themselves.
  const range = await page.getByTestId('shopping-range').textContent()
  await page.getByRole('button', { name: 'Semana siguiente' }).click()
  await expect(page.getByTestId('shopping-range')).not.toHaveText(range ?? '')
  await expect(line(page, COOKIES)).toBeVisible({ timeout: 20_000 })
  await expect(line(page, ONION)).toBeVisible()
  await expect(line(page, ONION).getByTestId('shopping-habitual')).toBeVisible()

  // Off: it is paused and stops coming.
  saved = habitualWrite(page)
  await star(page, ONION).click()
  await saved
  await expect(line(page, ONION)).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: 'Semana siguiente' }).click()
  await expect(line(page, COOKIES)).toBeVisible({ timeout: 20_000 })
  await expect(line(page, ONION)).toHaveCount(0)

  // Back on this week: the onion is still on the menu's list, not habitual.
  await page.getByRole('button', { name: 'Semana anterior' }).click()
  await expect(star(page, ONION)).toHaveAttribute('aria-pressed', 'false', { timeout: 20_000 })
})

test('the line sheet has the «Habitual» switch too', async ({ page }) => {
  await page.goto('/shopping')
  await expect(line(page, ONION)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: `Cambiar ${ONION}`, exact: true }).click()
  const sw = page.getByRole('switch', { name: 'Habitual' })
  await expect(sw).not.toBeChecked()
  const saved = habitualWrite(page)
  await sw.click()
  await saved
  await expect(sw).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(star(page, ONION)).toHaveAttribute('aria-pressed', 'true')
})
