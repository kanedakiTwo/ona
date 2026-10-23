/**
 * PRO-175: a line of the list can be changed or left out, and it stays so
 * after reloading. Menu lines: «No lo compro esta semana» (and «Volver a
 * añadir»), or the household's own amount. Manual lines: deleted for good.
 * PRO-182: «¿Cuánto os queda en casa?» leaves only the rest to buy.
 */
import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser, completeOnboarding, generateWeekWithListRows } from './_helpers'
import { pinClock } from './_clock'

test.use({ timezoneId: 'Europe/Madrid' })

test.beforeEach(async ({ page }) => {
  test.setTimeout(90_000)
  await pinClock(page)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  await generateWeekWithListRows(page)
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
  // PRO-292: the amount is the field on the line itself.
  await expect(page.getByLabel(`Cantidad de ${name}`, { exact: true })).toHaveValue('777')
  await expect(row).toContainText('cambiada (menú:')

  await page.reload()
  await expect(page.getByLabel(`Cantidad de ${name}`, { exact: true })).toHaveValue('777', { timeout: 15_000 })
  await expect(page.getByRole('button', { name: `Cambiar ${name}`, exact: true })).toContainText('cambiada (menú:')
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
  await expect(row).toBeVisible()
  await expect(page.getByLabel('Cantidad de Pañales talla 4', { exact: true })).toHaveValue('2')
  await expect(page.getByTestId('shopping-line').filter({ has: row })).toContainText('paquetes')

  // PRO-292: «Quitar» on the line, with «Deshacer» instead of a confirm.
  await page.getByRole('button', { name: 'Quitar Pañales talla 4', exact: true }).click()
  await expect(row).toHaveCount(0)
  await expect(page.getByTestId('shopping-undo')).toContainText('Pañales talla 4')
  await page.reload()
  await firstLine(page)
  await expect(page.getByText('Pañales talla 4')).toHaveCount(0)
})

test('a menu line: what is left at home is subtracted, also after a reload (PRO-182)', async ({ page }) => {
  await page.goto('/shopping')
  const name = await firstLine(page)
  const row = page.getByRole('button', { name: `Cambiar ${name}`, exact: true })
  // Raise the amount first so «1» at home always leaves something to buy.
  await row.click()
  await page.getByLabel('Cantidad a comprar').fill('500')
  await page.getByRole('button', { name: 'Guardar cantidad' }).click()
  await expect(page.getByLabel(`Cantidad de ${name}`, { exact: true })).toHaveValue('500')

  await row.click()
  await page.getByLabel('Cuánto queda en casa').fill('100')
  await page.getByRole('button', { name: 'Comprar solo lo que falta' }).click()
  await expect(row.getByTestId('shopping-missing')).toContainText('Te faltan 400')
  await expect(row.getByTestId('shopping-missing')).toContainText('ya tienes 100')

  await page.reload()
  const again = page.getByRole('button', { name: `Cambiar ${name}`, exact: true })
  await expect(again.getByTestId('shopping-missing')).toContainText('Te faltan 400', { timeout: 15_000 })
})
