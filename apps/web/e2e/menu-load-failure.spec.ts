/**
 * A failed menu GET must never look like an empty week. The /menu page
 * auto-creates an empty week when there's none; before 2026-10-07 any error
 * (500, offline) counted as "none" and the page wrote an empty week on top of
 * the real one. Now: an error card with "Reintentar" and no POST
 * /menu/generate. (The API also refuses an unforced empty over dishes — see
 * menuWeekRoute.smoke.ts.)
 */

import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const MENU_GET = /\/menu\/[0-9a-f-]{36}\/\d{4}-\d{2}-\d{2}$/

test('a failing menu GET shows a retry card and never creates a week', async ({ page }) => {
  await registerFreshUser(page)
  await completeOnboarding(page)

  let generates = 0
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/menu/generate')) generates += 1
  })
  await page.route(MENU_GET, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal server error"}' })
      : route.continue(),
  )

  await page.goto('/menu')
  await expect(page.getByText(/no hemos podido/i)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/tu semana está/i)).toHaveCount(0)
  await page.waitForTimeout(1500)
  expect(generates).toBe(0)

  // Back online: "Reintentar" loads the real week.
  await page.unroute(MENU_GET)
  await page.getByRole('button', { name: /reintentar/i }).click()
  await expect(page.getByText(/no hemos podido/i)).toHaveCount(0, { timeout: 15_000 })
})
