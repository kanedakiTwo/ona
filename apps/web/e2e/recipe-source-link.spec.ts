/**
 * PRO-57: catalogue recipes that came from Notion carry the original link
 * (backfilled by `applyCatalogSourceLinks`, which `db:seed` and `db:migrate`
 * run), and the detail shows «Ver fuente» pointing at it. Fails if the seed
 * stops linking the catalogue or the detail stops rendering the link.
 */

import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const apiUrl = process.env.API_URL ?? 'http://localhost:8765'

test('a catalogue recipe with its Notion link shows «Ver fuente»', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  // Catalogue recipes (authorId null) with a source link, read anonymously.
  const list: Array<{ id: string }> = await (await page.request.get(`${apiUrl}/recipes?perPage=100`)).json()
  let target: { id: string; sourceUrl: string } | null = null
  for (const r of list) {
    const full = await (await page.request.get(`${apiUrl}/recipes/${r.id}`)).json()
    if (full.authorId == null && typeof full.sourceUrl === 'string' && full.sourceUrl.length > 0) {
      target = { id: full.id, sourceUrl: full.sourceUrl }
      break
    }
  }
  expect(target, 'the seeded catalogue should have at least one recipe linked to its original').not.toBeNull()

  await page.goto(`/recipes/${target!.id}`)
  const link = page.getByRole('link', { name: /ver fuente/i })
  await expect(link).toBeVisible({ timeout: 15_000 })
  await expect(link).toHaveAttribute('href', target!.sourceUrl)
  await expect(link).toHaveAttribute('target', '_blank')
})
