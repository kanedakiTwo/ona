/**
 * «Invitar a otro hogar» button (PRO-163, D-059; specs/auth.md): in Perfil
 * and under the shopping list, it opens WhatsApp with Miguel's approved
 * text and the account's own link (PRO-162); each tap counts as
 * `invite_shared` (GET /admin/usage → referrals). 390×844.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'
import { E2E_ADMIN } from './global-setup'

const API = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

async function inviteSharedTotal(page: Page): Promise<number | null> {
  const login = await page.request.post(`${API}/login`, { data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password } })
  if (!login.ok()) return null
  const { token, user } = await login.json()
  if (user?.role !== 'admin') return null
  const r = await page.request.get(`${API}/admin/usage?days=7&includeInternal=1`, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok()) return null
  const body = await r.json()
  const weeks: Array<{ inviteShared: number }> = body.referrals ?? []
  return weeks.reduce((n, w) => n + (w.inviteShared ?? 0), 0)
}

function userToken(page: Page) {
  return page.evaluate(() => localStorage.getItem('ona_token'))
}

test('Perfil and the shopping list: WhatsApp with the approved text and my code; each tap counts', async ({ page, context }) => {
  test.setTimeout(120_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  const token = await userToken(page)
  const me = await (await page.request.get(`${API}/referrals/me`, { headers: { Authorization: `Bearer ${token}` } })).json()
  expect(me.code).toBeTruthy()
  const text = `Yo uso Mimoia para el menú de la semana: le escribes por WhatsApp y te lo hace, con la lista de la compra. Pruébalo con mi enlace: ${me.link}`
  const expectedHref = `https://wa.me/?text=${encodeURIComponent(text)}`
  expect(me.link).toContain(`?invita=${me.code}`)

  const before = await inviteSharedTotal(page)

  // Don't actually leave for wa.me: the new tab is closed as soon as it opens.
  context.on('page', (p) => void p.close().catch(() => {}))
  await page.route(/wa\.me/, (route) => route.fulfill({ status: 204, body: '' }))

  await page.goto('/profile')
  const profileButton = page.getByTestId('invite-household-perfil').getByTestId('invite-household-whatsapp')
  await expect(profileButton).toHaveAttribute('href', expectedHref, { timeout: 15_000 })
  await expect(profileButton).toHaveText(/Invitar a otro hogar/)
  // «Copiar» is for computers only.
  await expect(page.getByTestId('invite-household-perfil').getByTestId('invite-household-copy')).toBeHidden()
  const counted1 = page.waitForResponse((r) => r.url().endsWith('/usage/invite-shared') && r.request().method() === 'POST')
  await profileButton.click()
  expect((await counted1).status()).toBe(204)

  await page.goto('/shopping')
  const shoppingButton = page.getByTestId('invite-household-compra').getByTestId('invite-household-whatsapp')
  await expect(shoppingButton).toHaveAttribute('href', expectedHref, { timeout: 20_000 })
  const counted2 = page.waitForResponse((r) => r.url().endsWith('/usage/invite-shared') && r.request().method() === 'POST')
  await shoppingButton.click()
  expect((await counted2).status()).toBe(204)

  if (before != null) {
    await expect.poll(() => inviteSharedTotal(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(before + 2)
  }
})
