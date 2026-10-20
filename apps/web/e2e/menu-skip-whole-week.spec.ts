/**
 * PRO-115: when «Saltar día» left the whole week without meals, /menu took
 * it for a broken `[{}, …]` row and "healed" it with an empty week: after a
 * reload the meals that were removed came back as empty slots. A week whose
 * days are empty because they were skipped is a real week.
 * Mobile (390×844), clock pinned to a weekday of this week.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'
import { pinClock } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { headers: { Authorization: `Bearer ${token}` }, userId }
}

test('a week with one day of dishes → «Saltar día» → reload: the day stays skipped and no empty slot comes back', async ({ page }) => {
  test.setTimeout(120_000)
  const { weekStart, dayIdx } = await pinClock(page)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const { headers, userId } = await session(page)
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
  const menu = await gen.json()

  // Only today keeps its meals: every other day loses all of them.
  for (let d = 0; d < 7; d++) {
    if (d === dayIdx) continue
    for (const meal of Object.keys(menu.days[d] ?? {})) {
      const del = await page.request.delete(`${API}/menu/${menu.id}/day/${d}/meal/${meal}`, { headers })
      expect(del.ok(), `delete ${d}/${meal}: ${del.status()}`).toBeTruthy()
    }
  }

  const generated: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/menu\/generate$/.test(r.url())) generated.push(r.postData() ?? '')
  })

  await page.goto('/menu')
  await expect(page.getByRole('button', { name: /^saltar día$/i })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /^saltar día$/i }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^saltar día$/i }).click()
  await expect(page.getByText('Día marcado sin cocinar.')).toBeVisible({ timeout: 10_000 })

  await page.reload()
  await expect(page.getByText('Día marcado sin cocinar.')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1_500) // let any self-heal fire, if it would
  expect(generated, 'the page must not rebuild the week').toEqual([])

  const after = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  expect(after.id).toBe(menu.id)
  expect(after.skippedDays).toEqual([dayIdx])
  expect((after.days as Record<string, unknown>[]).every((d) => Object.keys(d ?? {}).length === 0)).toBe(true)
})
