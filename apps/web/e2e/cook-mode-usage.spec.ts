/**
 * PRO-188: «ha cocinado» in the funnel counts opening cook mode on the web.
 * The cook page pings POST /usage/cook-mode-started once when it opens
 * (the API records `cook_mode_started`, channel web).
 */

import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

test('opening cook mode on the web sends one cook_mode_started ping', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  await page.goto('/recipes')
  const card = page.getByRole('main').locator('a[href^="/recipes/"]:not([href="/recipes/new"])').first()
  await expect(card).toBeVisible({ timeout: 15_000 })
  const href = await card.getAttribute('href')
  const id = href!.match(/\/recipes\/([0-9a-f-]{36})/)![1]

  const pings: number[] = []
  page.on('response', (r) => {
    if (r.url().endsWith('/usage/cook-mode-started') && r.request().method() === 'POST') pings.push(r.status())
  })
  await page.goto(`/recipes/${id}/cook`)
  await expect.poll(() => pings, { timeout: 15_000 }).toEqual([204])
  await page.waitForTimeout(800)
  expect(pings).toEqual([204])
})
