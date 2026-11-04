/**
 * PRO-1103: every field of /register and /recipes/new carries its mark —
 * « *» when required, « (opcional)» when not — and both forms end with
 * «* Obligatorio». Fails as soon as a field of either screen loses its mark.
 */
import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser, useE2ECampaign } from './_helpers'
import { unmarkedFields } from './_fieldMarks'

test('/register: every field is marked', async ({ page }) => {
  await useE2ECampaign(page)
  await page.goto('/register')
  const form = page.locator('form')
  await expect(form.getByRole('checkbox', { name: 'Tengo 14 años o más' })).toBeVisible()

  expect(await unmarkedFields(form)).toEqual([])
  // The asterisk is aria-hidden: the accessible names stay as they were.
  await expect(form.getByLabel('Email', { exact: true })).toHaveAttribute('required', '')
  await expect(form.locator('[data-field-mark="required"]')).toHaveCount(4)
  await expect(form.locator('[data-field-mark="optional"]')).toHaveCount(1)
  await expect(form.locator('[data-required-note]')).toHaveText('* Obligatorio')
})

test('/recipes/new: every field is marked', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  await page.goto('/recipes/new')
  const form = page.locator('form', { has: page.locator('#recipe-name') })
  await expect(form.locator('#recipe-name')).toBeVisible({ timeout: 15_000 })

  expect(await unmarkedFields(form)).toEqual([])
  await expect(form.locator('label[for="recipe-name"] [data-field-mark="required"]')).toHaveCount(1)
  await expect(form.locator('label[for="recipe-tags"]')).toContainText('(opcionales)')
  // No «(opcional)» left in a placeholder: it lives in the label.
  for (const placeholder of await form.locator('[placeholder]').evaluateAll((els) => els.map((e) => e.getAttribute('placeholder')))) {
    expect(placeholder).not.toMatch(/opcional/i)
  }
  await expect(form.locator('[data-required-note]')).toHaveText('* Obligatorio')
})
