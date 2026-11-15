/**
 * PRO-1203 · «Quién come», persona a persona. Mobile (390×844).
 *
 * In Perfil, one row per person of the house. Adding someone who doesn't use
 * Mimoia («la pequeña», 3–5 años) and giving her an allergy shows it in her
 * row; the menu reads it with everyone else's (the API side is
 * `quienCome.smoke.ts`). A household whose counter says more people than
 * are described shows them as rows to describe or remove.
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

test('add a person, give her an allergy and see it in her row', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await completeOnboarding(page)

  await page.goto('/profile')
  const whoEats = page.getByTestId('who-eats')
  await expect(whoEats.getByTestId('who-eats-row')).toHaveCount(1, { timeout: 15_000 })
  await expect(whoEats).toContainText('Adulto · tú')
  // The old counter and «Preferencias» are gone.
  await expect(page.getByText('Niños 2–10')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Guardar cambios' })).toHaveCount(0)

  // «+ Añadir a alguien que no usa Mimoia»: a minor only with a generic alias.
  await whoEats.getByRole('button', { name: 'Añadir a alguien que no usa Mimoia' }).click()
  const form = page.getByTestId('ficha-person-form')
  await form.getByLabel('Apodo').fill('la pequeña')
  await form.getByText('3–5 años').click()
  await form.getByRole('button', { name: 'Guardar' }).click()
  const row = whoEats.getByTestId('who-eats-row').filter({ hasText: 'la pequeña' })
  await expect(row).toContainText('3–5 años', { timeout: 15_000 })
  await expect(whoEats).toContainText('para 1 adulto y 1 niño')

  // Her allergies: health data, with my consent.
  await row.click()
  await expect(page).toHaveURL(/\/profile\/quien\/[0-9a-f-]{36}$/, { timeout: 15_000 })
  const allergies = page.getByTestId('person-restrictions')
  // The box follows the server: once given, it goes and the list opens.
  await allergies.getByRole('checkbox', { name: /datos de salud/i }).click()
  await expect(allergies.getByRole('checkbox', { name: /datos de salud/i })).toHaveCount(0, { timeout: 10_000 })
  await allergies.getByRole('button', { name: 'frutos secos', exact: false }).first().click()
  await expect(allergies.getByRole('button', { name: 'Quitar frutos secos' })).toBeVisible({ timeout: 10_000 })
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/households\/me\/people\/[^/]+\/restrictions$/.test(r.url()))
  await allergies.getByRole('button', { name: 'Guardar' }).click()
  expect((await saved).ok()).toBe(true)

  // Back in Perfil: the chip in her row.
  await page.goto('/profile')
  await expect(page.getByTestId('who-eats-row').filter({ hasText: 'la pequeña' })).toContainText('frutos secos', { timeout: 15_000 })

  const s = await session(page)
  const people = await (await page.request.get(`${API_URL}/households/me/people`, { headers: s.auth })).json()
  expect(people.people.find((p: { name: string }) => p.name === 'la pequeña').restrictions).toEqual(['frutos secos'])
})

test('a household with only the old counter: describe one, remove the other', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const s = await session(page)
  // The counter says 2 adults and 1 child; nobody is described yet.
  expect((await page.request.put(`${API_URL}/user/${s.userId}`, { headers: s.auth, data: { adults: 2, kidsCount: 1 } })).ok()).toBe(true)

  await page.goto('/profile')
  const whoEats = page.getByTestId('who-eats')
  await expect(whoEats.getByTestId('who-eats-extra')).toHaveCount(2, { timeout: 15_000 })
  await expect(whoEats).toContainText('para 2 adultos y 1 niño')

  // «Un niño» → «Describir»: it becomes that child, the size stays.
  await whoEats.getByTestId('who-eats-extra').filter({ hasText: 'Un niño' }).getByRole('button', { name: 'Describir' }).click()
  const form = page.getByTestId('ficha-person-form')
  await form.getByLabel('Apodo').fill('el mayor')
  await form.getByRole('button', { name: 'Guardar' }).click()
  await expect(whoEats.getByTestId('who-eats-row').filter({ hasText: 'el mayor' })).toContainText('6–12 años', { timeout: 15_000 })
  await expect(whoEats.getByTestId('who-eats-extra')).toHaveCount(1)
  await expect(whoEats).toContainText('para 2 adultos y 1 niño')

  // «Otro adulto» → «No está»: one adult fewer for the shopping list.
  await whoEats.getByRole('button', { name: 'Otro adulto: no está' }).click()
  await expect(whoEats.getByTestId('who-eats-extra')).toHaveCount(0, { timeout: 15_000 })
  await expect(whoEats).toContainText('para 1 adulto y 1 niño')
  const account = await (await page.request.get(`${API_URL}/user/${s.userId}`, { headers: s.auth })).json()
  expect(account).toMatchObject({ adults: 1, kidsCount: 1 })
})
