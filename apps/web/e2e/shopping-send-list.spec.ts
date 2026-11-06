/**
 * «Mandar la lista» (PRO-380, D-158; specs/shopping.md): the list's main
 * button. «Por WhatsApp» opens wa.me with what's left by aisle and the
 * household's code in the footer link, and the send counts as
 * `shopping_list_shared` (GET /admin/usage → daily events). 390×844.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, generateWeekWithListRows, registerFreshUser } from './_helpers'
import { pinClock } from './_clock'
import { E2E_ADMIN } from './global-setup'

const API = process.env.API_URL ?? 'http://localhost:8765'

test.use({ timezoneId: 'Europe/Madrid', viewport: { width: 390, height: 844 } })

async function listSharedTotal(page: Page): Promise<number | null> {
  const login = await page.request.post(`${API}/login`, { data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password } })
  if (!login.ok()) return null
  const { token, user } = await login.json()
  if (user?.role !== 'admin') return null
  const r = await page.request.get(`${API}/admin/usage?days=7&includeInternal=1`, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok()) return null
  const body = await r.json()
  const days: Array<{ events: Record<string, number> }> = body.daily ?? []
  return days.reduce((n, d) => n + (d.events?.shopping_list_shared ?? 0), 0)
}

test('the main button is «Mandar la lista»; «Por WhatsApp» opens wa.me by aisle with my code, and it counts', async ({ page, context }) => {
  test.setTimeout(120_000)
  await pinClock(page)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  await generateWeekWithListRows(page)

  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const me = await (await page.request.get(`${API}/referrals/me`, { headers: { Authorization: `Bearer ${token}` } })).json()
  expect(me.code).toBeTruthy()

  const before = await listSharedTotal(page)

  // Don't actually leave for wa.me: the new tab is closed as soon as it opens.
  context.on('page', (p) => void p.close().catch(() => {}))
  await page.route(/wa\.me/, (route) => route.fulfill({ status: 204, body: '' }))

  await page.goto('/shopping')
  await expect(page.getByTestId('shopping-line').first()).toBeVisible({ timeout: 20_000 })
  const main = page.getByTestId('send-list')
  await expect(main).toContainText('Mandar la lista', { timeout: 15_000 })
  await expect(main).toBeEnabled({ timeout: 15_000 })
  await main.click()

  const sheet = page.getByTestId('send-list-sheet')
  await expect(sheet).toBeVisible({ timeout: 10_000 })
  const whatsapp = sheet.getByTestId('send-list-whatsapp')
  await expect(whatsapp).toBeVisible()
  await expect(sheet.getByTestId('send-list-copy')).toBeVisible()
  // Waits for the code: the link is ready once the footer carries it.
  await expect(whatsapp).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/, { timeout: 15_000 })
  await expect
    .poll(async () => decodeURIComponent(((await whatsapp.getAttribute('href')) ?? '').replace('https://wa.me/?text=', '')), { timeout: 15_000 })
    .toContain(`/?ref=lista&invita=${me.code}`)
  const text = decodeURIComponent((await whatsapp.getAttribute('href'))!.replace('https://wa.me/?text=', ''))
  // By aisle: a bold aisle heading, then «- name…» lines.
  expect(text).toContain('Lista de la compra')
  expect(text).toMatch(/\n\*[^*\n]+\*\n- \S/)

  const counted = page.waitForResponse((r) => r.url().includes('/usage/list-shared') && r.request().method() === 'POST', { timeout: 15_000 })
  await whatsapp.click()
  const res = await counted
  expect(res.status()).toBe(204)
  expect(res.request().postDataJSON()).toMatchObject({ channel: 'web', via: 'whatsapp' })

  if (before != null) {
    await expect.poll(() => listSharedTotal(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(before + 1)
  }
})
