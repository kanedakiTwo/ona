/**
 * PRO-175: a line of the list can be changed or left out, and it stays so
 * after reloading. Menu lines: «No lo compro esta semana» (and «Volver a
 * añadir»), or the household's own amount. Manual lines: deleted for good.
 */
import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'
import { pinClock, pinnedDay } from './_clock'

test.use({ timezoneId: 'Europe/Madrid' })

const apiUrl = process.env.API_URL ?? 'http://localhost:8765'

async function generateThisWeek(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user'))) ?? '{}')
  const { weekStart, dayIdx } = pinnedDay()
  const headers = { Authorization: `Bearer ${token}` }
  const res = await page.request.post(`${apiUrl}/menu/generate`, { headers, data: { userId: user.id, weekStart } })
  expect(res.ok(), `menu/generate ${res.status()}`).toBeTruthy()
  // The API generates with the server's real date: make sure «today» has a
  // dish so the shopping list from today has rows.
  const menu = await (await page.request.get(`${apiUrl}/menu/${user.id}/${weekStart}`, { headers })).json()
  const hasRecipe = Object.values(menu.days?.[dayIdx] ?? {}).some((slot: any) =>
    slot?.dishes?.some((d: { kind: string }) => d.kind === 'recipe'),
  )
  if (!hasRecipe) {
    if (menu.days?.[dayIdx]?.lunch) await page.request.delete(`${apiUrl}/menu/${menu.id}/day/${dayIdx}/meal/lunch`, { headers })
    let add = await page.request.post(`${apiUrl}/menu/${menu.id}/day/${dayIdx}/meal/lunch`, { headers })
    if (!add.ok()) {
      // The small CI catalogue may have no free recipe left: repeat one of the week.
      const recipeId = (menu.days ?? [])
        .flatMap((day: Record<string, any>) => Object.values(day ?? {}))
        .flatMap((slot: any) => slot?.dishes ?? [])
        .find((d: { kind: string; recipeId?: string }) => d.kind === 'recipe')?.recipeId
      add = await page.request.post(`${apiUrl}/menu/${menu.id}/day/${dayIdx}/meal/lunch`, { headers, data: { recipeId } })
    }
    expect(add.ok(), `add lunch ${add.status()}`).toBeTruthy()
  }
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(90_000)
  await pinClock(page)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  await generateThisWeek(page)
})

/** A line to buy whose name appears once (two units of one product make two rows). */
async function firstLine(page: Page) {
  const buttons = page.getByRole('button', { name: /^Cambiar / })
  await expect(buttons.first()).toBeVisible({ timeout: 15_000 })
  const labels = (await buttons.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))).map((l) => l.replace(/^Cambiar /, ''))
  const unique = labels.find((l) => labels.filter((x) => x === l).length === 1)
  expect(unique, 'a line with a unique name').toBeTruthy()
  return unique!
}

test('a menu line: «No lo compro esta semana» survives a reload, and comes back', async ({ page }) => {
  await page.goto('/shopping')
  const name = await firstLine(page)
  await page.getByRole('button', { name: `Cambiar ${name}`, exact: true }).click()
  await page.getByRole('button', { name: 'No lo compro esta semana' }).click()

  const skipped = page.getByTestId('shopping-skipped')
  await expect(skipped).toContainText(name)
  await expect(page.getByRole('button', { name: `Cambiar ${name}`, exact: true })).toHaveCount(0)

  await page.reload()
  await expect(page.getByTestId('shopping-skipped')).toContainText(name, { timeout: 15_000 })

  await page.getByRole('button', { name: `Volver a añadir ${name}`, exact: true }).click()
  await expect(page.getByRole('button', { name: `Cambiar ${name}`, exact: true })).toBeVisible()
  await expect(page.getByTestId('shopping-skipped')).toHaveCount(0)
})

test('a menu line: its own amount survives a reload', async ({ page }) => {
  await page.goto('/shopping')
  const name = await firstLine(page)
  const row = page.getByRole('button', { name: `Cambiar ${name}`, exact: true })
  await row.click()
  const input = page.getByLabel('Cantidad a comprar')
  await input.fill('777')
  await page.getByRole('button', { name: 'Guardar cantidad' }).click()
  await expect(row).toContainText('777')
  await expect(row).toContainText('cambiada (menú:')

  await page.reload()
  const again = page.getByRole('button', { name: `Cambiar ${name}`, exact: true })
  await expect(again).toContainText('777', { timeout: 15_000 })
  await expect(again).toContainText('cambiada (menú:')
})

test('a manual line is deleted and does not come back after a reload', async ({ page }) => {
  await page.goto('/shopping')
  await firstLine(page)
  await page.getByRole('button', { name: 'Opciones de la compra' }).first().click()
  await page.getByRole('button', { name: /Añadir a mano/ }).click()
  await page.getByPlaceholder('Ej: Pan de molde integral').fill('Pañales talla 4')
  await page.getByLabel(/^Cantidad \(opcional\)/).fill('2 paquetes')
  await page.getByRole('button', { name: 'Añadir', exact: true }).click()
  await page.getByRole('button', { name: 'Cerrar' }).first().click()

  const row = page.getByRole('button', { name: 'Cambiar Pañales talla 4', exact: true })
  await expect(row).toContainText('2 paquetes')

  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Eliminar item manual' }).click()
  await expect(row).toHaveCount(0)
  await page.reload()
  await firstLine(page)
  await expect(page.getByText('Pañales talla 4')).toHaveCount(0)
})
