/**
 * PRO-161: after the WhatsApp sign-up the web doesn't jump straight to /menu.
 * Mimo built the first menu in the chat without allergies (health data never
 * goes through WhatsApp), so a short «Tu menú está listo» screen asks for them
 * with the separate consent box; with something added the week is rebuilt
 * without it. Then /menu with the two-step «Primeros pasos» (no step about
 * Mimo's web button: they talk to Mimo by WhatsApp). At 390×844.
 * /whatsapp/* is mocked; the chat's complete_onboarding is played through the
 * real API (onboarding without restrictions + this week's menu).
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { firstMenuWeeks } from '@ona/shared'
import { registerFreshUser } from './_helpers'

test.use({ viewport: { width: 390, height: 844 } })

const API = process.env.API_URL ?? 'http://localhost:8765'

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function mockWhatsApp(page: Page) {
  const state = { linked: false }
  await page.route('**/whatsapp/status', (route) =>
    json(route, {
      available: true,
      linked: state.linked,
      phone: state.linked ? '+34 ••• ••• 222' : null,
      notify: false,
      chatLink: state.linked ? 'https://wa.me/15550001111' : null,
    }),
  )
  await page.route('**/whatsapp/link-code', (route) =>
    json(route, {
      code: '4F7K2A',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      message: 'Vincular Mimoia: 4F7K2A',
      waLink: 'https://wa.me/15550001111?text=Vincular%20Mimoia%3A%204F7K2A',
    }, 201),
  )
  return state
}

async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { userId, headers: { Authorization: `Bearer ${token}` } }
}

/** What Mimo's complete_onboarding does in the chat: answers without restrictions + this week's menu. */
async function mimoFinishesInTheChat(page: Page) {
  const { userId, headers } = await session(page)
  const onb = await page.request.post(`${API}/user/${userId}/onboarding`, {
    headers,
    data: { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], favoriteDishes: ['lentejas'], priority: 'healthy' },
  })
  expect(onb.ok(), `onboarding: ${onb.status()}`).toBeTruthy()
  const gen = await page.request.post(`${API}/menu/generate`, {
    headers,
    data: { userId, weekStart: firstMenuWeeks().weeks[0] },
  })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()
}

async function signUpByWhatsApp(page: Page) {
  const wa = await mockWhatsApp(page)
  await registerFreshUser(page, { keepFirstSteps: true })
  await page.goto('/onboarding')
  await page.getByRole('button', { name: /por whatsapp/i }).click()
  await expect(page.getByTestId('onboarding-whatsapp-message')).toBeVisible({ timeout: 15_000 })
  wa.linked = true
  await expect(page.getByTestId('onboarding-whatsapp-linked')).toBeVisible({ timeout: 8_000 })
  await mimoFinishesInTheChat(page)
  const ready = page.getByTestId('onboarding-menu-ready')
  await expect(ready).toBeVisible({ timeout: 15_000 })
  await expect(ready.getByRole('heading', { name: /tu menú está listo/i })).toBeVisible()
  await expect(page).toHaveURL(/\/onboarding/)
}

function recipeIds(menu: { days: Record<string, { dishes?: { kind: string; recipeId?: string }[] }>[] }): string[] {
  const out: string[] = []
  for (const day of menu.days ?? []) {
    for (const slot of Object.values(day ?? {})) {
      for (const d of slot?.dishes ?? []) if (d.kind === 'recipe' && d.recipeId) out.push(d.recipeId)
    }
  }
  return out
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('WhatsApp sign-up → «Tu menú está listo» → sin gluten + consent → menu rebuilt without gluten → two-step guide', async ({ page }) => {
  test.setTimeout(120_000)
  await signUpByWhatsApp(page)
  const ready = page.getByTestId('onboarding-menu-ready')

  // Chips are off until the consent box is ticked.
  const glutenChip = ready.getByRole('button', { name: 'sin gluten', exact: true })
  await expect(glutenChip).toBeDisabled()
  await ready.getByRole('checkbox', { name: /consiento que mimoia trate mis datos de salud/i }).check()
  await glutenChip.click()
  await expect(glutenChip).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  const rebuilt = page.waitForRequest((r) => r.method() === 'POST' && /\/menu\/generate$/.test(r.url()))
  await ready.getByRole('button', { name: 'Ver mi menú' }).click()
  await rebuilt
  await expect(page).toHaveURL(/\/menu/, { timeout: 30_000 })

  // Stored with the consent, and the week has nothing with gluten.
  const { userId, headers } = await session(page)
  const profile = await (await page.request.get(`${API}/user/${userId}`, { headers })).json()
  expect(profile.restrictions).toEqual(['sin gluten'])
  expect(profile.healthConsentAt).toBeTruthy()
  const all = (await (await page.request.get(`${API}/recipes?perPage=200`, { headers })).json()) as { id: string }[]
  const fits = new Set(
    ((await (await page.request.get(`${API}/recipes?perPage=200&fitsMe=1`, { headers })).json()) as { id: string }[]).map((r) => r.id),
  )
  expect(fits.size, 'the seed has recipes with gluten').toBeLessThan(all.length)
  const week = await (await page.request.get(`${API}/menu/${userId}/${firstMenuWeeks().weeks[0]}`, { headers })).json()
  const ids = recipeIds(week)
  expect(ids.length).toBeGreaterThan(0)
  expect(ids.filter((id) => !fits.has(id))).toEqual([])

  // «Primeros pasos» in two steps: the dish's «···» and the list, not Mimo's button.
  const guide = page.getByTestId('first-steps')
  await expect(guide).toBeVisible({ timeout: 20_000 })
  const dialog = guide.getByRole('dialog')
  await expect(dialog).toContainText('1 de 2')
  await expect(dialog.getByRole('heading')).toHaveText('Toca «···» en un plato para cambiarlo')
  await dialog.getByRole('button', { name: 'Siguiente' }).click()
  await expect(dialog).toContainText('2 de 2')
  await expect(dialog.getByRole('heading')).toHaveText('Aquí tienes la lista de la compra: se hace sola')
  await dialog.getByRole('button', { name: 'Entendido' }).click()
  await expect(guide).toHaveCount(0)
})

test('without ticking anything, «Ver mi menú» goes to /menu and keeps Mimo’s menu', async ({ page }) => {
  test.setTimeout(90_000)
  const generated: string[] = []
  await signUpByWhatsApp(page)
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/menu\/generate$/.test(r.url())) generated.push(r.url())
  })
  await page.getByTestId('onboarding-menu-ready').getByRole('button', { name: 'Ver mi menú' }).click()
  await expect(page).toHaveURL(/\/menu/, { timeout: 20_000 })
  await expect(page.getByTestId('first-steps').getByRole('dialog')).toContainText('1 de 2', { timeout: 20_000 })
  expect(generated).toEqual([])
})
