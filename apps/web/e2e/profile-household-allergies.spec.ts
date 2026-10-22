/**
 * Feedback of a beta tester, 2026-10-22. Mobile (390×844).
 *  - «En el perfil no se habían guardado los hijos aunque en WhatsApp sí me
 *    habla de ellos»: what Mimo notes (`household.kids_2_to_10`) is the
 *    account's count too, and /profile reads the account, not the copy kept
 *    in this browser.
 *  - «He sido incapaz de ver dónde meter intolerancia al pimiento»: the
 *    profile has «Alergias e intolerancias», which takes free text — saved
 *    even when «Guardar» is tapped without pressing Enter.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user')))!)
  return { auth: { Authorization: `Bearer ${token}` }, userId: user.id as string }
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
})

test('kids Mimo noted show in the profile; «Alergias e intolerancias» takes «pimiento»', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const s = await session(page)

  // Mimo notes «tenemos dos niños» (update_memory writes this same store).
  const noted = await page.request.patch(`${API_URL}/memory`, { headers: s.auth, data: { facts: [{ key: 'household.kids_2_to_10', value: 2 }] } })
  expect(noted.ok()).toBe(true)

  // This browser still says 0 niños; the profile shows the account.
  await page.goto('/profile')
  await expect(page.getByText(/1 adulto · 2 niños/)).toBeVisible({ timeout: 15_000 })

  await page.getByRole('link', { name: /alergias e intolerancias/i }).click()
  await expect(page).toHaveURL(/\/profile\/casa\/alergias/, { timeout: 15_000 })
  await page.getByRole('checkbox', { name: /datos de salud/i }).check()
  await expect(page.getByRole('button', { name: /^no tengo ninguna$/i })).toBeVisible()
  // Typed, no Enter: the button already says «Guardar» and saves it.
  await page.getByPlaceholder(/p\. ej\. pimiento/i).fill('Pimiento')
  await page.getByRole('button', { name: /^guardar$/i }).click()
  // Back on /profile itself (the alergias URL ends in «?next=/profile» too).
  await page.waitForURL((u) => u.pathname === '/profile', { timeout: 15_000 })

  const account = await (await page.request.get(`${API_URL}/user/${s.userId}`, { headers: s.auth })).json()
  expect(account.restrictions).toEqual(['pimiento'])
  await expect(page.getByRole('link', { name: /alergias e intolerancias/i })).toContainText('pimiento', { timeout: 15_000 })
})
