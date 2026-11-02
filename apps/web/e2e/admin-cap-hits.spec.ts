/**
 * PRO-1090 (D-148): Admin → Usuarios shows «Han llegado al tope este mes»,
 * the same count as GET /admin/metrics → `capHits`. Desktop (the admin lives
 * there). Who gets counted is checked against Postgres in capHits.smoke.ts.
 */

import { test, expect, type Page } from '@playwright/test'
import { E2E_ADMIN } from './global-setup'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

async function loginAsAdmin(page: Page): Promise<string> {
  const r = await page.request.post(`${API_URL}/login`, { data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password } })
  expect(r.ok()).toBeTruthy()
  const { token, user } = await r.json()
  test.skip(user?.role !== 'admin', 'needs ADMIN_EMAILS on the API (see global-setup.ts)')
  await page.addInitScript(
    ([t, u]) => {
      localStorage.setItem('ona_token', t)
      localStorage.setItem('ona_user', u)
    },
    [token, JSON.stringify(user)] as const,
  )
  return token
}

test('Usuarios: the «Han llegado al tope este mes» card has the capHits total', async ({ page }) => {
  const token = await loginAsAdmin(page)
  const metrics = await page.request.get(`${API_URL}/admin/metrics?weeks=1`, { headers: { Authorization: `Bearer ${token}` } })
  expect(metrics.ok()).toBeTruthy()
  const { capHits } = await metrics.json()
  expect(capHits).toMatchObject({ porTope: { asistente: expect.any(Number), ia: expect.any(Number) }, porCanal: { app: expect.any(Number), whatsapp: expect.any(Number) } })

  await page.goto('/admin/usuarios')
  const card = page.getByTestId('cap-hits-card')
  await expect(card).toContainText('Han llegado al tope este mes', { timeout: 15_000 })
  await expect(card.getByTestId('cap-hits-total')).toHaveText(String(capHits.total))
})
