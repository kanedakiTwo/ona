/**
 * «Imprimir la semana» (PRO-112, specs/menus.md): from the week's «···»
 * sheet, a print view with the 7 days and, on a second A4 sheet that can be
 * left out, the shopping list by aisle. The browser's print dialog does the
 * rest (also «Guardar como PDF»); here Chromium renders the PDF itself.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const API = process.env.API_URL ?? 'http://localhost:8765'

function thisMonday(): string {
  const d = new Date()
  d.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function generateThisWeek(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const res = await page.request.post(`${API}/menu/generate`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { userId, weekStart: thisMonday(), force: true },
  })
  expect(res.ok()).toBeTruthy()
}

const pdfPages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length

test('print the week: 7 days, the shopping list on a second sheet, and without it', async ({ page }) => {
  test.setTimeout(120_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  await generateThisWeek(page)

  await page.goto('/menu')
  await page.getByRole('button', { name: 'Opciones de la semana' }).click()
  await page.getByRole('dialog').getByRole('link', { name: /imprimir la semana/i }).click()
  await page.waitForURL(new RegExp(`/menu/imprimir\\?week=${thisMonday()}`), { timeout: 20_000 })

  const sheet = page.getByTestId('print-week-sheet')
  await expect(sheet).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('print-day')).toHaveCount(7)
  await expect(page.getByTestId('print-day').first()).toContainText(/lunes/i)
  await expect(sheet.locator('tbody tr').first()).toBeVisible()

  const list = page.getByTestId('print-shopping-sheet')
  await expect(list).toBeVisible()
  await expect(list.getByText('Lista de la compra')).toBeVisible()
  await expect(list.locator('li').first()).toBeVisible({ timeout: 15_000 })

  // A4 PDF: the week and the list on two sheets; the toolbar doesn't print.
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByRole('button', { name: 'Imprimir' })).toBeHidden()
  await page.emulateMedia({ media: 'screen' })
  const withList = await page.pdf({ format: 'A4', landscape: true, preferCSSPageSize: true })
  expect(pdfPages(withList)).toBeGreaterThanOrEqual(2)

  // Without the list: one sheet.
  await page.getByRole('checkbox', { name: /incluir la lista de la compra/i }).uncheck()
  await expect(list).toHaveCount(0)
  const weekOnly = await page.pdf({ format: 'A4', landscape: true, preferCSSPageSize: true })
  expect(pdfPages(weekOnly)).toBe(1)
})
