/**
 * PRO-1041 (Seguridad; hogares de prueba 2026-10-24 → 2026-10-31): Lucía,
 * celíaca, told Mimo by WhatsApp and gave her «sí» in writing, but the
 * consent is only given on the web and nothing was saved. Now Mimo sends a
 * link to «Tus alergias y tu dieta» with what she said already marked
 * (`#marcar=…`, never sent to a server):
 *   - signed out, the link goes through the login and comes back marked;
 *   - the box is still unticked and «Guardar» asks for it; «No tengo
 *     ninguna» is not offered over what she said;
 *   - ticked, it's saved.
 * 390×844.
 */
import { test, expect } from '@playwright/test'
import { e2eInvite, submitLoginForm, uniqueId } from './_helpers'

const API = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

test('enlace de Mimo → login → «sin gluten» ya marcado → casilla → guardado', async ({ page, request }) => {
  test.setTimeout(90_000)
  const username = `alerg${uniqueId().replace(/-/g, '')}`.slice(0, 30)
  const password = 'e2epass123'
  const reg = await request.post(`${API}/register`, {
    data: { username, email: `${username}@test.local`, password, ageConfirmed: true, ...e2eInvite() },
  })
  expect(reg.status()).toBe(201)
  const { token, user } = await reg.json()
  const headers = { Authorization: `Bearer ${token}` }
  const onb = await request.post(`${API}/user/${user.id}/onboarding`, {
    headers,
    data: { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], priority: 'healthy' },
  })
  expect(onb.ok(), `onboarding: ${onb.status()}`).toBeTruthy()

  // What the browser asks any server for: the allergy never travels.
  const urls: string[] = []
  page.on('request', (r) => urls.push(r.url()))

  await page.goto('/profile/casa/alergias?next=%2Fmenu#marcar=sin%20gluten')
  await page.waitForURL(/\/login/, { timeout: 15_000 })
  await Promise.all([
    page.waitForURL(/\/profile\/casa\/alergias/, { timeout: 20_000 }),
    submitLoginForm(page, { username, password }),
  ])

  const screen = page.getByTestId('household-allergies')
  await expect(screen.getByTestId('household-allergies-marked')).toContainText('sin gluten', { timeout: 15_000 })
  const chip = screen.getByRole('button', { name: 'sin gluten', exact: true })
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await expect(chip).toBeDisabled()
  const box = screen.getByRole('checkbox', { name: 'Consiento que Mimoia trate mis datos de salud' })
  await expect(box).not.toBeChecked()
  await expect(screen.getByRole('button', { name: /No tengo ninguna/ })).toHaveCount(0)

  // Without the box, nothing is saved: it asks for it.
  await screen.getByRole('button', { name: 'Guardar y ver el menú' }).click()
  await expect(screen.getByRole('alert')).toContainText('marca antes la casilla')
  const before = await (await request.get(`${API}/user/${user.id}`, { headers })).json()
  expect(before.restrictions).toEqual([])

  // Until saved, no request carried it: Playwright's request URL keeps the
  // fragment, which the browser never sends, so only what goes before `#`.
  expect(urls.map((u) => decodeURIComponent(u.split('#')[0])).filter((u) => /gluten|marcar/i.test(u))).toEqual([])

  await box.check()
  await screen.getByRole('button', { name: 'Guardar y ver el menú' }).click()
  await page.waitForURL((u) => u.pathname === '/menu', { timeout: 20_000 })

  const after = await (await request.get(`${API}/user/${user.id}`, { headers })).json()
  expect(after.restrictions).toEqual(['sin gluten'])
  const consent = await (await request.get(`${API}/user/${user.id}/health-consent`, { headers })).json()
  expect(consent.active).toBe(true)
})
