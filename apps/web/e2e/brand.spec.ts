/**
 * Brand rename (2026-10-08): the product is Mimoia everywhere users see it
 * and the assistant is Mimo. Fails if the app wordmark, the recipe eyebrow or
 * the public footer regress to the old brand name, to the old hola@ona.app contact,
 * or if the landing goes back to its own footer (two footers, "Issue №01").
 * The string-level guard for the whole codebase is
 * apps/api/src/tests/brandName.test.ts; the assistant greeting and the AI
 * disclosure are pinned in ai-disclosure.spec.ts.
 *
 * Imagotipo (2026-10-09): the spoon-with-a-heart symbol + "mimoia" lockup in
 * the public navbar, the footer and the desktop sidebar; Mimo's button wears
 * the same spoon; icons and favicon are generated from it. Fails if a header
 * goes back to a bare text wordmark or the icons stop being served.
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

async function expectLogo(page: Page, testId: string) {
  const logo = page.getByTestId(testId)
  await expect(logo.getByTestId('mimoia-symbol')).toBeVisible()
  await expect(logo).toHaveText('mimoia')
}

test('the landing and the other public pages share one footer with the real contact', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Mimoia, inicio' })).toBeVisible()
  await expectLogo(page, 'public-logo')
  await page.getByTestId('site-footer').scrollIntoViewIfNeeded()
  await expectSharedFooter(page)
  await expectLogo(page, 'footer-logo')

  await page.goto('/como-funciona')
  await expectSharedFooter(page)
})

test('the logged-in app says Mimoia: desktop wordmark and recipe eyebrow', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  await completeOnboarding(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/menu')
  await expect(page.getByTestId('app-wordmark')).toHaveText('mimoia', { timeout: 10_000 })
  await expect(page.getByTestId('app-wordmark').getByTestId('mimoia-symbol')).toBeVisible()
  await expect(page.getByTestId('mimo-button').getByTestId('mimoia-symbol')).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  const list: Array<{ id: string }> = await (await page.request.get(`${apiUrl}/recipes?perPage=1`)).json()
  await page.goto(`/recipes/${list[0].id}`)
  await expect(page.getByText('Mimoia · Receta').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/\b(ONA|Ona) · Receta/i)).toHaveCount(0)
})

test('icons, favicon and the profile photo are the generated imagotipo', async ({ request }) => {
  const ico = await request.get('/favicon.ico')
  expect(ico.status()).toBe(200)
  const bytes = await ico.body()
  // A real .ico (reserved 0, type 1) with the 16, 32 and 48 px images — not a PNG renamed.
  expect([...bytes.subarray(0, 4)]).toEqual([0, 0, 1, 0])
  expect(bytes.readUInt16LE(4)).toBe(3)

  const svg = await request.get('/icon.svg')
  expect(svg.status()).toBe(200)
  expect(await svg.text()).toContain('<path d="M20.21 5.18')

  const manifest = await (await request.get('/manifest.webmanifest')).json()
  for (const icon of manifest.icons as Array<{ src: string }>) {
    const res = await request.get(icon.src)
    expect(res.status(), icon.src).toBe(200)
    expect(res.headers()['content-type']).toContain('image/png')
  }
  for (const file of ['/icons/apple-touch-icon.png', '/brand/mimoia-perfil.png', '/brand/mimoia-simbolo.svg']) {
    expect((await request.get(file)).status(), file).toBe(200)
  }
})
