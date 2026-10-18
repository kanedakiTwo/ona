/**
 * PRO-217: the sign-up asks «¿Cómo cocináis en casa?» right after how often
 * they cook, with four answers; the answer goes to the household's ficha and
 * Perfil shows it and changes it with one tap. At 390×844 (iPhone 14).
 */
import { test, expect } from '@playwright/test'
import { registerFreshUser } from './_helpers'

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
  await page.getByRole('button', { name: /3-4 veces/i }).click()
  await next.click()

  // Step 3: the new question, right after how often they cook.
  const step = page.getByTestId('onboarding-cooking-style')
  await expect(step.getByRole('heading', { name: /cómo cocináis en casa/i })).toBeVisible()
  await expect(page.getByText('Primeros pasos · 3 de 6')).toBeVisible()
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
  await next.click() // no restrictions
  await page.getByRole('button', { name: /salud/i }).click()
  await page.getByRole('button', { name: /empezar/i }).click()
  expect(JSON.parse((await onboarding).postData() ?? '{}').cookingStyle).toBe('batch')
  await expect(page).toHaveURL(/\/menu/, { timeout: 30_000 })

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
