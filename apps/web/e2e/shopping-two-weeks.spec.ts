/**
 * PRO-269 (Laura, Familia Ruiz 2026-10-19/20): «Esta semana» showed «19 oct –
 * 1 nov», two weeks, and the list didn't say what was for which. Now the
 * chip says what it shows: «Esta semana» (today → Sunday), «La que viene»
 * (next Monday → Sunday) and «Dos semanas» (the default, both), and with
 * two weeks on screen every menu line says its week.
 * Mobile (390×844); the browser clock is pinned to a weekday (PRO-142) so the
 * week has days left whatever day CI runs.
 */
import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'
import { pinClock } from './_clock'

const apiUrl = process.env.API_URL ?? 'http://localhost:8765'

test.use({ timezoneId: 'Europe/Madrid', viewport: { width: 390, height: 844 } })

const plus = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function auth(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user'))) ?? '{}')
  return { headers: { Authorization: `Bearer ${token}` }, userId: user.id as string }
}

async function listCount(page: Page, headers: Record<string, string>, from: string, to: string) {
  const res = await page.request.get(`${apiUrl}/shopping-list?from=${from}&to=${to}`, { headers })
  expect(res.ok(), `shopping-list ${res.status()}`).toBeTruthy()
  return ((await res.json()).items ?? []).length as number
}

test('/shopping: «Esta semana» is this week, «La que viene» the next, and two weeks say which is which', async ({ page }) => {
  test.setTimeout(120_000)
  // Wednesday: this week still has days left.
  const { weekStart, at } = await pinClock(page, 2)
  const today = at.toISOString().slice(0, 10)
  const sunday = plus(weekStart, 6)
  const nextMonday = plus(weekStart, 7)
  const nextSunday = plus(weekStart, 13)

  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  const { headers, userId } = await auth(page)
  for (const ws of [weekStart, nextMonday]) {
    const gen = await page.request.post(`${apiUrl}/menu/generate`, { headers, data: { userId, weekStart: ws } })
    expect(gen.ok(), `menu/generate ${ws} ${gen.status()}`).toBeTruthy()
  }
  const thisWeek = await listCount(page, headers, today, sunday)
  const nextWeek = await listCount(page, headers, nextMonday, nextSunday)
  const both = await listCount(page, headers, today, nextSunday)
  expect(nextWeek).toBeGreaterThan(0)

  await page.goto('/shopping')
  const range = page.getByTestId('shopping-range')
  const total = page.getByTestId('shopping-total')
  await expect(total).toHaveText(String(both), { timeout: 15_000 })

  const semana = page.getByRole('button', { name: 'Esta semana', exact: true })
  const siguiente = page.getByRole('button', { name: 'La que viene', exact: true })
  const dos = page.getByRole('button', { name: 'Dos semanas', exact: true })
  // The default is the two weeks, and its chip says so.
  await expect(dos).toHaveAttribute('aria-pressed', 'true')
  await expect(semana).toHaveAttribute('aria-pressed', 'false')
  await expect(range).toContainText(String(Number(nextSunday.slice(8))))

  // Two weeks on screen: every menu line says which week it's for.
  const tags = page.getByTestId('shopping-line-week')
  await expect(tags.first()).toBeVisible({ timeout: 15_000 })
  for (const t of await tags.allTextContents()) {
    expect(t.trim().toLowerCase()).toMatch(/^(esta semana|la que viene|las dos semanas)$/)
  }
  await expect(page.getByTestId('shopping-line-week').filter({ hasText: /la que viene|las dos semanas/i }).first()).toBeVisible()

  // «Esta semana»: today → Sunday, and nothing of next week.
  await semana.click()
  await expect(semana).toHaveAttribute('aria-pressed', 'true')
  await expect(dos).toHaveAttribute('aria-pressed', 'false')
  await expect(range).toContainText(String(Number(sunday.slice(8))))
  await expect(total).toHaveText(String(thisWeek), { timeout: 15_000 })
  await expect(tags).toHaveCount(0)
  if (thisWeek > 0) await expect(page.getByTestId('shopping-total-title')).toHaveText('Total de esta semana estimado')

  // «La que viene»: next Monday → Sunday.
  await siguiente.click()
  await expect(siguiente).toHaveAttribute('aria-pressed', 'true')
  await expect(range).toContainText(String(Number(nextMonday.slice(8))))
  await expect(total).toHaveText(String(nextWeek), { timeout: 15_000 })
  await expect(tags).toHaveCount(0)
  await expect(page.getByTestId('shopping-total-title')).toHaveText('Total de la semana que viene estimado')

  // Back to both.
  await dos.click()
  await expect(dos).toHaveAttribute('aria-pressed', 'true')
  await expect(total).toHaveText(String(both), { timeout: 15_000 })
  await expect(tags.first()).toBeVisible()
})
