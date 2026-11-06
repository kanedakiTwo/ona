/**
 * PRO-217: the sign-up asks «¿Cómo cocináis en casa?» with four answers; the
 * answer goes to the household's ficha and Perfil shows it and changes it
 * with one tap. Since 2026-11-03 it is the second question: «¿Cuántas veces a
 * la semana cocinas?» is gone (the API reads it from this answer) and so is
 * «¿Qué quieres que Mimoia priorice?». At 390×844 (iPhone 14).
 */
import { test, expect } from '@playwright/test'
import { answerShopper, registerFreshUser } from './_helpers'

test.use({ viewport: { width: 390, height: 844 } })

test('«¿Cómo cocináis en casa?» in the sign-up → Perfil shows it and changes it', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await page.goto('/onboarding')
  // If WhatsApp is available the first screen offers the channel: stay on the web.
  const web = page.getByRole('button', { name: /prefiero la web/i })
  const household = page.getByRole('heading', { name: /para cuántos cocinas/i })
  await expect(web.or(household)).toBeVisible({ timeout: 15_000 })
  if (await web.isVisible()) await web.click()

  const next = page.getByRole('button', { name: /siguiente/i })
  await next.click()
  // PRO-383: two adults (the default) are asked who does the shopping.
  await answerShopper(page)

  // Then how they cook, with no «¿Cuántas veces…?» before it.
  const step = page.getByTestId('onboarding-cooking-style')
  await expect(step.getByRole('heading', { name: /cómo cocináis en casa/i })).toBeVisible()
  await expect(page.getByText('Primeros pasos · 3 de 5')).toBeVisible()
  await expect(next).toBeDisabled()
  await expect(step.getByRole('button', { name: /^cocino cada día/i })).toBeVisible()
  await expect(step.getByRole('button', { name: /^cocino unos días y aprovecho para otros/i })).toBeVisible()
  await expect(step.getByRole('button', { name: /^batch cooking.*cocino una o dos veces y dejo hecha la semana/i })).toBeVisible()
  await expect(step.getByRole('button', { name: /^improviso.*decido cada día/i })).toBeVisible()
  await step.getByRole('button', { name: /^batch cooking/i }).click()
  await expect(step.getByRole('button', { name: /^batch cooking/i })).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await next.click()

  const onboarding = page.waitForRequest((r) => r.method() === 'POST' && /\/user\/[^/]+\/onboarding$/.test(r.url()))
  await page.getByRole('button', { name: /sin prisa/i }).click()
  await next.click()
  // The allergies question is the last one: no «¿Qué quieres que Mimoia priorice?» after it.
  await expect(page.getByRole('heading', { name: /hay algo que no comas/i })).toBeVisible()
  await expect(page.getByText('Primeros pasos · 5 de 5')).toBeVisible()
  await page.getByRole('button', { name: /empezar/i }).click() // no restrictions
  const body = JSON.parse((await onboarding).postData() ?? '{}')
  expect(body.cookingStyle).toBe('batch')
  expect(body).not.toHaveProperty('cookingFreq')
  expect(body).not.toHaveProperty('priority')
  await expect(page).toHaveURL(/\/menu/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: /priorice/i })).toHaveCount(0)

  // How often they cook, read from it: batch cooking is cooking little.
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user')))!).id
  const apiUrl = process.env.API_URL ?? 'http://localhost:8765'
  const user = await (await page.request.get(`${apiUrl}/user/${userId}`, { headers: { Authorization: `Bearer ${token}` } })).json()
  expect(user.cookingFreq).toBe('rarely')

  // Perfil: the same answer, changed with one tap and kept after a reload.
  await page.goto('/profile')
  const card = page.getByTestId('profile-cooking-style')
  await expect(card).toContainText('Batch cooking', { timeout: 15_000 })
  await expect(card.getByRole('button', { name: /^batch cooking/i })).toHaveAttribute('aria-pressed', 'true')
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/household\/cooking-style$/.test(r.url()))
  await card.getByRole('button', { name: /^improviso/i }).click()
  expect((await saved).ok()).toBe(true)
  await page.reload()
  await expect(page.getByTestId('profile-cooking-style').getByRole('button', { name: /^improviso/i })).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
