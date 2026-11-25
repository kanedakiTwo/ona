/**
 * PRO-1263 · «Otra que no esté en la lista» in the sign-up (390×844). A test
 * household (2026-11-17) found the box disabled without a reason and, with
 * the health box ticked, wrote «nada d alergias. la abuela no come higado ni
 * ver y el peque las acelgas tampoco jaja»: nothing was saved (the «nada»
 * swallowed it). Now the disabled box says why, and the text is read
 * (rules: no Anthropic key in e2e) and shows in Perfil.
 */
import { test, expect, type Page } from '@playwright/test'
import { answerShopper, registerFreshUser } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'
const IRENE = 'nada d alergias. la abuela no come higado ni ver y el peque las acelgas tampoco jaja'

async function savedRestrictions(page: Page): Promise<string[]> {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const me = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user')))!) as { id: string }
  const res = await page.request.get(`${API_URL}/user/${me.id}`, { headers: { Authorization: `Bearer ${token}` } })
  return (await res.json()).restrictions ?? []
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
})

test('the sign-up\'s first screen: «Otra» says why it is disabled, and what is written is saved and shows in Perfil', async ({ page }) => {
  test.setTimeout(90_000)
  // The page after /register would stamp «Afina tu menú» as shown before
  // /onboarding loads, and the allergies-first screen goes with it.
  await page.route(/\/taste\/offers$/, (route) =>
    route.request().postDataJSON()?.event === 'onboarding'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
      : route.continue(),
  )
  await registerFreshUser(page, { keepTaste: true })
  await page.goto('/onboarding')

  const allergies = page.getByTestId('onboarding-allergies-first')
  await expect(allergies.getByRole('heading', { name: /antes de nada, ¿hay algo que no comáis/i })).toBeVisible({ timeout: 20_000 })
  const other = allergies.getByLabel(/otra que no esté en la lista/i)
  await expect(other).toBeDisabled()
  await expect(other).toHaveAccessibleDescription(/marca antes el permiso de datos de salud/i)

  await allergies.getByRole('checkbox', { name: /datos de salud/i }).check()
  await expect(other).toBeEnabled()
  await other.fill(IRENE)
  // «Siguiente» without Enter: what is typed counts.
  await allergies.getByRole('button', { name: 'Siguiente' }).click()
  await expect(page.getByRole('heading', { name: /dime qué te apetece/i })).toBeVisible({ timeout: 20_000 })

  const saved = await savedRestrictions(page)
  expect(saved).toContain('higado')
  expect(saved.join(' ')).not.toContain('nada')

  await page.goto('/profile/casa/alergias')
  const box = page.getByTestId('household-allergies')
  await expect(box.getByText('higado', { exact: true })).toBeVisible({ timeout: 20_000 })
})

test('the questions\' allergies step: what is written in «Otra» is read when the sign-up is saved', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await page.goto('/onboarding')
  const next = page.getByRole('button', { name: /siguiente/i })
  await next.click({ timeout: 20_000 }) // 2 adults (default)
  await answerShopper(page)
  await page.getByRole('button', { name: /^cocino cada día/i }).click()
  await next.click()
  await page.getByRole('button', { name: /sin prisa/i }).click()
  await next.click()
  await page.getByRole('checkbox', { name: /datos de salud/i }).check()
  await page.getByRole('button', { name: /sin gluten/i }).click()
  await page.getByLabel(/otra que no esté en la lista/i).fill(IRENE)
  await page.getByRole('button', { name: /empezar/i }).click()
  await expect(page).toHaveURL(/\/menu/, { timeout: 45_000 })

  const saved = await savedRestrictions(page)
  expect(saved).toEqual(expect.arrayContaining(['sin gluten', 'higado']))
  expect(saved.join(' ')).not.toContain('nada')
})
