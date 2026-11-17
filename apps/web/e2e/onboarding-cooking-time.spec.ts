/**
 * PRO-138: the onboarding asks, in one tap, how the user likes to cook on
 * weekdays (total time vs hands-on time) with an optional free field below.
 * The answer is stored as `time_available` in the memory and shows in
 * «Lo que recuerdo de ti». At 390×844 (iPhone 14).
 */
import { test, expect } from '@playwright/test'
import { answerShopper, registerFreshUser } from './_helpers'

test.use({ viewport: { width: 390, height: 844 } })

test('weekday cooking question + «tu caso» field → time limits in the memory', async ({ page }) => {
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
  await answerShopper(page) // PRO-383: two adults (the default)
  // PRO-217: «¿Cómo cocináis en casa?»
  await page.getByRole('button', { name: /^cocino cada día/i }).click()
  await next.click()

  // Then the weekday time: one tap, and the optional field.
  await expect(page.getByRole('heading', { name: /entre semana, ¿cómo te gusta cocinar/i })).toBeVisible()
  await expect(page.getByText('Primeros pasos · 4 de 5')).toBeVisible()
  await expect(page.getByText('El fin de semana, sin prisa.')).toBeVisible()
  await expect(next).toBeDisabled()
  for (const label of [/^rápido/i, /^poco rato de trabajo/i, /^sin prisa/i]) {
    await expect(page.getByRole('button', { name: label })).toBeVisible()
  }
  const note = page.getByLabel(/algo más\? cuéntanos tu caso/i)
  await expect(note).toBeVisible()
  await expect(note).toHaveAttribute('placeholder', /pasta los miércoles/)
  await page.getByRole('button', { name: /^poco rato de trabajo/i }).click()
  await expect(page.getByRole('button', { name: /^poco rato de trabajo/i })).toHaveAttribute('aria-pressed', 'true')
  await note.fill('teletrabajo y puedo dejar algo al fuego')
  // Nothing spills sideways on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  const onboarding = page.waitForRequest((r) => r.method() === 'POST' && /\/user\/[^/]+\/onboarding$/.test(r.url()))
  await next.click()
  await page.getByRole('button', { name: /empezar/i }).click() // no restrictions

  const body = JSON.parse((await onboarding).postData() ?? '{}')
  expect(body.weekdayCooking).toBe('poco_trabajo')
  expect(body.cookingNote).toBe('teletrabajo y puedo dejar algo al fuego')
  await expect(page).toHaveURL(/\/menu/, { timeout: 30_000 })

  // «Lo que recuerdo de ti»: weekdays with 20 minutes of work.
  await page.goto('/profile/memoria')
  await expect(page.getByText(/lunes: 20 min de trabajo/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/viernes: 20 min de trabajo/)).toBeVisible()
  await expect(page.getByText(/sabado:/)).toHaveCount(0)
})
