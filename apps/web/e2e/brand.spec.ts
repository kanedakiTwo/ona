/**
 * Brand rename (2026-10-08): the product is Mimoia everywhere users see it
 * and the assistant is Mimo. Fails if the app wordmark, the recipe eyebrow or
 * the public footer regress to "ONA"/"Ona", to the old hola@ona.app contact,
 * or if the landing goes back to its own footer (two footers, "Issue №01").
 * The string-level guard for the whole codebase is
 * apps/api/src/tests/brandName.test.ts; the assistant greeting and the AI
 * disclosure are pinned in ai-disclosure.spec.ts.
 */

import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const apiUrl = process.env.API_URL ?? 'http://localhost:8765'
const OLD_NAME = /\b(ONA|Ona)\b/

async function expectSharedFooter(page: Page) {
  // Public pages render inside <main>, so the <footer> isn't a contentinfo landmark.
  const footer = page.locator('footer')
  await expect(footer).toHaveCount(1)
  await expect(footer).toHaveAttribute('data-testid', 'site-footer')
  await expect(footer.getByRole('link', { name: 'hola@mimoia.com' })).toHaveAttribute('href', 'mailto:hola@mimoia.com')
  for (const label of ['Cómo funciona', 'Recetas', 'Privacidad', 'Términos']) {
    await expect(footer.getByRole('link', { name: label, exact: true })).toBeVisible()
  }
  await expect(footer).toContainText('© 2026 Mimoia')
  const text = await footer.innerText()
  expect(text).not.toMatch(/ona\.app|Issue|Filosofia|Terminos|Como funciona/)
  expect(text).not.toMatch(OLD_NAME)
}

test('the landing and the other public pages share one footer with the real contact', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('site-footer').scrollIntoViewIfNeeded()
  await expectSharedFooter(page)

  await page.goto('/como-funciona')
  await expectSharedFooter(page)
})

test('the logged-in app says Mimoia: desktop wordmark and recipe eyebrow', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  await completeOnboarding(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/menu')
  await expect(page.getByTestId('app-wordmark')).toHaveText('Mimoia', { timeout: 10_000 })

  await page.setViewportSize({ width: 390, height: 844 })
  const list: Array<{ id: string }> = await (await page.request.get(`${apiUrl}/recipes?perPage=1`)).json()
  await page.goto(`/recipes/${list[0].id}`)
  await expect(page.getByText('Mimoia · Receta').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/ONA · Receta/i)).toHaveCount(0)
})
