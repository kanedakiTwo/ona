/**
 * «Primeros pasos» (PRO-07): the first time a new account lands on /menu,
 * three steps over the real screen (the «···» of the day's dish, the shopping
 * tab, Mimo's button).
 * Skippable; saved on the account (not the browser), so after skipping and
 * reloading it doesn't come back.
 * Accounts that predate it never see it: the column defaults to "seen", which
 * is the same state as an account that already skipped it (see
 * apps/api/src/tests/firstStepsPending.test.ts for the rule).
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const API = process.env.API_URL ?? 'http://localhost:8765'

async function firstStepsPending(page: Page): Promise<boolean> {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  const res = await page.request.get(`${API}/user/${userId}`, { headers: { Authorization: `Bearer ${token}` } })
  expect(res.ok()).toBeTruthy()
  return Boolean((await res.json()).firstStepsPending)
}

test('a new account sees the three steps on /menu, skips them, reloads and they are gone', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page, { keepFirstSteps: true })
  await completeOnboarding(page, { keepFirstSteps: true })
  await expect(page).toHaveURL(/\/menu/)

  const guide = page.getByTestId('first-steps')
  await expect(guide).toBeVisible({ timeout: 20_000 })
  const dialog = guide.getByRole('dialog')
  await expect(dialog).toContainText('1 de 3')
  await expect(dialog.getByRole('heading')).toHaveText('Toca «···» en un plato para cambiarlo')

  // PRO-68: step 1 lights up a «···» button — the day's dish's, or the first
  // empty slot's while the week is still blank — never the whole dish
  // (tapping the dish itself opens the recipe).
  const spotlight = guide.getByTestId('first-steps-spotlight')
  await expect(spotlight).toBeVisible({ timeout: 10_000 })
  await expect
    .poll(async () => {
      const s = await spotlight.boundingBox()
      const b = await page.evaluate(() => {
        const visible = (el: Element | null) => {
          const r = el?.getBoundingClientRect()
          return r && r.width > 0 && r.height > 0 ? r : null
        }
        const pick = (sel: string) => Array.from(document.querySelectorAll(sel)).map(visible).find(Boolean) ?? null
        const r = pick('[data-first-steps="dish"] [data-meal-options]') ?? pick('[data-meal-options]')
        return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
      })
      if (!b || !s) return false
      // Spotlight = the «···» button + 6 px padding on each side.
      return (
        Math.abs(s.x + s.width / 2 - (b.x + b.width / 2)) < 3 &&
        Math.abs(s.y + s.height / 2 - (b.y + b.height / 2)) < 3 &&
        Math.abs(s.width - (b.width + 12)) < 3 &&
        Math.abs(s.height - (b.height + 12)) < 3
      )
    })
    .toBe(true)

  await dialog.getByRole('button', { name: 'Siguiente' }).click()
  await expect(dialog).toContainText('2 de 3')
  await expect(dialog.getByRole('heading')).toHaveText('Aquí tienes la lista de la compra: se hace sola')

  await dialog.getByRole('button', { name: 'Siguiente' }).click()
  await expect(dialog).toContainText('3 de 3')
  await expect(dialog.getByRole('heading')).toHaveText('Este es Mimo: pídele lo que quieras')
  await expect(dialog.getByRole('button', { name: 'Entendido' })).toBeVisible()

  // Skip → gone, saved on the account.
  await dialog.getByRole('button', { name: 'Saltar' }).click()
  await expect(guide).toHaveCount(0)
  await expect.poll(() => firstStepsPending(page)).toBe(false)

  // Reload: the dismissal lives on the account, so it stays gone.
  await page.reload()
  await expect(page.getByTestId('menu-week-range')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1_500)
  await expect(page.getByTestId('first-steps')).toHaveCount(0)
})

test('an account that is not new (guide already marked as seen) never sees it', async ({ page }) => {
  test.setTimeout(60_000)
  // Default helpers: the account is in the same state as one created before
  // the guide existed (first_steps_pending = false).
  await registerFreshUser(page)
  await completeOnboarding(page)
  expect(await firstStepsPending(page)).toBe(false)

  await expect(page.getByTestId('menu-week-range')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1_500)
  await expect(page.getByTestId('first-steps')).toHaveCount(0)
})
