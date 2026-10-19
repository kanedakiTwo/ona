/**
 * PRO-122: Mimo's floating button (right) and «Opinión» (left) covered the
 * edge of controls at 390 px: the box of a new ingredient, the shopping
 * list's quantities, «Añadir comida», the account deletion card, «Guardar
 * cambios» (hogares de prueba, 2026-10-18/19). Now the page reserves their
 * room at the end (and when scrolling a control into view), and both hide
 * while a sheet is open or the keyboard is up. Mobile 390×844.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

test.use({ viewport: { width: 390, height: 844 } })

type Box = { x: number; y: number; width: number; height: number }
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** Boxes of the floating buttons on screen right now. */
async function floatingBoxes(page: Page): Promise<Box[]> {
  const out: Box[] = []
  for (const id of ['mimo-button', 'feedback-button']) {
    const el = page.getByTestId(id)
    if ((await el.count()) && (await el.isVisible())) out.push((await el.boundingBox())!)
  }
  return out
}

/** At the end of the page, no control in the main area is under a floating button. */
async function expectNothingCoveredAtEnd(page: Page, label: string) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(400)
  const fabs = await floatingBoxes(page)
  expect(fabs.length, `${label}: the floating buttons are there`).toBeGreaterThan(0)
  const covered = await page.evaluate((fabs) => {
    const hit = (a: DOMRect, b: { x: number; y: number; width: number; height: number }) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    const out: string[] = []
    for (const el of document.querySelectorAll('main a, main button, main input, main select, main textarea')) {
      const r = (el as HTMLElement).getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || r.bottom <= 0 || r.top >= window.innerHeight) continue
      if (getComputedStyle(el).visibility === 'hidden') continue
      if (fabs.some((f) => hit(r, f))) out.push(`${el.tagName} «${(el.textContent || (el as HTMLInputElement).placeholder || '').trim().slice(0, 40)}»`)
    }
    return out
  }, fabs)
  expect(covered, `${label}: controls under a floating button`).toEqual([])
}

/** Scrolled into view (as a tap or focus does), the control is clear of them. */
async function expectClear(page: Page, locator: ReturnType<Page['locator']>, label: string) {
  await locator.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  const box = (await locator.boundingBox())!
  for (const f of await floatingBoxes(page)) expect(intersects(box, f), `${label} under a floating button`).toBe(false)
}

async function expectHidden(page: Page, label: string) {
  await expect(page.getByTestId('mimo-button'), label).toHaveCount(0)
  await expect(page.getByTestId('feedback-button'), label).toHaveCount(0)
}

test('no floating button covers a control at 390×844; both hide with a sheet or the keyboard', async ({ page }) => {
  test.setTimeout(150_000)
  await registerFreshUser(page)
  await completeOnboarding(page)

  // «Añadir comida» on the menu, and its sheet.
  await page.goto('/menu')
  const addMeal = page.getByRole('button', { name: /^añadir comida$/i })
  const skip = page.getByRole('button', { name: /^saltar día$/i })
  await expect(skip).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('mimo-button')).toBeVisible()
  await expectNothingCoveredAtEnd(page, '/menu')
  await expectClear(page, skip, '«Saltar día»')
  if (await addMeal.count()) {
    await expectClear(page, addMeal, '«Añadir comida»')
    await addMeal.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectHidden(page, 'with the «Añadir comida» sheet open')
    await page.keyboard.press('Escape')
  }

  // The shopping list, quantities included.
  await page.goto('/shopping')
  await expect(page.getByTestId('shopping-total')).toBeVisible({ timeout: 20_000 })
  await expectNothingCoveredAtEnd(page, '/shopping')

  // Deleting the account: the card at the end of the profile.
  await page.goto('/profile')
  const del = page.getByRole('button', { name: 'Borrar mi cuenta' })
  await expect(del).toBeVisible({ timeout: 20_000 })
  await expectClear(page, del, '«Borrar mi cuenta»')
  await del.click()
  await expectClear(page, page.getByText('— No se puede deshacer.'), '«No se puede deshacer»')
  await expectClear(page, page.getByRole('button', { name: 'Borrar definitivamente' }), '«Borrar definitivamente»')
  await expectNothingCoveredAtEnd(page, '/profile with the deletion card')
  await page.locator('#delete-password').focus()
  await expectHidden(page, 'typing the password (keyboard up)')
  await page.locator('#delete-password').blur()
  await expect(page.getByTestId('mimo-button')).toBeVisible()

  // A new recipe: the ingredient box, and the sticky «Crear receta» bar.
  await page.goto('/recipes/new')
  const ingredient = page.getByPlaceholder(/ingrediente|cargando/i).first()
  await expect(ingredient).toBeVisible({ timeout: 20_000 })
  await expectClear(page, ingredient, 'the ingredient box')
  await ingredient.focus()
  await expectHidden(page, 'typing an ingredient (keyboard up)')
  await ingredient.blur()
  await expect(page.getByTestId('feedback-button')).toBeVisible()
  const submit = page.locator('main').getByRole('button', { name: /crear receta/i })
  await expectClear(page, submit, '«Crear receta»')
  await expectNothingCoveredAtEnd(page, '/recipes/new')
})
