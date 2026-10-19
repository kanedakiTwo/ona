/**
 * PRO-221: the sign-up asks, in one tap and next to «¿Cómo cocináis en
 * casa?», whether they freeze meat or fish. «A veces» saves the habit
 * (the thaw alert then says «Si lo tienes congelado, sácalo hoy.» — checked
 * against a real menu in freezeHabit.smoke.ts) and «Lo que recuerdo de ti»
 * shows and changes it. At 390×844 (iPhone 14).
 */
import { test, expect } from '@playwright/test'
import { registerFreshUser } from './_helpers'

test.use({ viewport: { width: 390, height: 844 } })

test('«¿Congeláis la carne o el pescado?» in the sign-up → «Lo que recuerdo de ti»', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await page.goto('/onboarding')
  const web = page.getByRole('button', { name: /prefiero la web/i })
  const household = page.getByRole('heading', { name: /para cuántos cocinas/i })
  await expect(web.or(household)).toBeVisible({ timeout: 15_000 })
  if (await web.isVisible()) await web.click()

  const next = page.getByRole('button', { name: /siguiente/i })
  await next.click()
  await page.getByRole('button', { name: /3-4 veces/i }).click()
  await next.click()

  // Step 3: the freezing question sits under «¿Cómo cocináis en casa?», optional.
  const freeze = page.getByTestId('onboarding-freeze')
  await expect(freeze).toContainText('¿Congeláis la carne o el pescado cuando compráis?')
  for (const label of ['Sí, casi siempre', 'A veces', 'No']) {
    await expect(freeze.getByRole('button', { name: label, exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: /^cocino cada día/i }).click()
  await freeze.getByRole('button', { name: 'A veces', exact: true }).click()
  await expect(freeze.getByRole('button', { name: 'A veces', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await next.click()

  const onboarding = page.waitForRequest((r) => r.method() === 'POST' && /\/user\/[^/]+\/onboarding$/.test(r.url()))
  await page.getByRole('button', { name: /sin prisa/i }).click()
  await next.click()
  await next.click() // no restrictions
  await page.getByRole('button', { name: /salud/i }).click()
  await page.getByRole('button', { name: /empezar/i }).click()
  expect(JSON.parse((await onboarding).postData() ?? '{}').freezesMeatFish).toBe('sometimes')
  await expect(page).toHaveURL(/\/menu/, { timeout: 30_000 })

  // «Lo que recuerdo de ti»: the habit, and the same question to change it.
  await page.goto('/profile/memoria')
  await expect(page.getByText('A veces congelo la carne y el pescado')).toBeVisible({ timeout: 15_000 })
  const card = page.getByTestId('memory-freeze')
  await expect(card.getByRole('button', { name: 'A veces', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await card.getByRole('button', { name: 'Sí, casi siempre', exact: true }).click()
  await expect(page.getByText('Congelo la carne y el pescado', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(card.getByRole('button', { name: 'Sí, casi siempre', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await card.getByRole('button', { name: 'No', exact: true }).click()
  await expect(card.getByRole('button', { name: 'No', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })
  await expect(page.getByText('Congelo la carne y el pescado', { exact: true })).toHaveCount(0)
})
