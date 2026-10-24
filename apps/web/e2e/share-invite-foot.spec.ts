/**
 * PRO-1016 (D-132): what people forward carries their household's invitation,
 * «Hecho con Mimo · mimoia.com/i/<code>» (specs/whatsapp.md for the week,
 * specs/shopping.md and specs/recipes.md for the shares):
 *   - the shared list («Compartir lo que queda») ends with it;
 *   - a shared catalogue recipe carries the code in its link, and the page
 *     opened from it shows the foot and keeps the code on the way in;
 *   - `/i/<household code>` opens the landing with `?invita=` and a sign-up
 *     from it is stored with `invited_by_code` = that household's code.
 * Headless Chromium has no Web Share, so share() falls back to the
 * clipboard. 390×844.
 */
import path from 'node:path'
import { createRequire } from 'node:module'
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, e2eInvite, generateWeekWithListRows, registerFreshUser, submitRegisterForm, uniqueId } from './_helpers'
import { testDatabaseUrl } from './_catalogDrafts'

const API = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] })

async function myCode(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const me = await (await page.request.get(`${API}/referrals/me`, { headers: { Authorization: `Bearer ${token}` } })).json()
  expect(me.code).toMatch(/^[0-9a-z]{8}$/)
  return me.code
}

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

test('the shared list and the shared recipe carry the household’s «Hecho con Mimo · …/i/<code>»', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  await generateWeekWithListRows(page)
  const code = await myCode(page)
  const host = new URL(page.url()).host

  // «Compartir lo que queda»: the foot is this household's invitation.
  const referral = page.waitForResponse((r) => r.url().endsWith('/referrals/me') && r.ok())
  await page.goto('/shopping')
  await referral
  await expect(page.getByRole('button', { name: /^Cambiar / }).first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Opciones de la compra' }).click()
  await page.getByRole('button', { name: /compartir lo que queda/i }).click()
  await expect.poll(() => clipboard(page)).toContain('Lista de compra · Mimoia')
  const list = await clipboard(page)
  expect(list.trimEnd().split('\n').pop()).toBe(`Hecho con Mimo · ${host}/i/${code}`)
  expect(list).not.toContain('?ref=lista')

  // A catalogue recipe: the code rides in the link (no text glued to it).
  const [recipe] = await (await page.request.get(`${API}/recipes?perPage=1`)).json()
  const again = page.waitForResponse((r) => r.url().endsWith('/referrals/me') && r.ok())
  await page.goto(`/recipes/${recipe.id}`)
  await again
  await page.getByRole('button', { name: /compartir receta/i }).first().click()
  await expect.poll(() => clipboard(page)).toContain(`/recipes/${recipe.id}?ref=receta&invita=${code}`)

  // Whoever opens it, signed out, sees the foot and keeps the code on the way in.
  const shared = new URL((await clipboard(page)).trim().split('\n').pop()!)
  const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const other = await visitor.newPage()
  await other.goto(shared.pathname + shared.search)
  await expect(other.getByRole('heading', { level: 1, name: recipe.name })).toBeVisible({ timeout: 20_000 })
  const foot = other.getByTestId('recipe-made-with').first()
  await foot.scrollIntoViewIfNeeded()
  await expect(foot).toHaveText(`Hecho con Mimo · ${host}/i/${code}`)
  await expect(other.getByTestId('recipe-signup-cta-link').first()).toHaveAttribute('href', new RegExp(`invita=${code}`))
  await other.waitForFunction(() => !!localStorage.getItem('ona.signupAttribution'), null, { timeout: 15_000 })
  expect(JSON.parse((await other.evaluate(() => localStorage.getItem('ona.signupAttribution')))!).invitedBy).toBe(code)
  await visitor.close()
})

test('/i/<household code> → landing with ?invita → the sign-up is stored with that household’s code', async ({ browser }) => {
  test.setTimeout(90_000)
  const id = uniqueId().replace(/-/g, '')
  const reg = await (await browser.newContext()).request.post(`${API}/register`, {
    data: { username: `foot${id}`.slice(0, 30), email: `foot${id}@test.local`, password: 'e2epass123', ageConfirmed: true, ...e2eInvite() },
  })
  expect(reg.status()).toBe(201)
  const { token } = await reg.json()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const me = await (await ctx.request.get(`${API}/referrals/me`, { headers: { Authorization: `Bearer ${token}` } })).json()

  const page = await ctx.newPage()
  await page.goto(`/i/${me.code}`)
  await expect(page).toHaveURL(new RegExp(`/\\?invita=${me.code}$`))
  await page.waitForFunction(() => !!localStorage.getItem('ona.signupAttribution'), null, { timeout: 15_000 })

  await page.goto('/register')
  const body = page.waitForRequest((r) => r.url().endsWith('/register') && r.method() === 'POST')
  const email = `ffo${id}@test.local`
  await Promise.all([
    page.waitForURL(/\/onboarding|\/menu/, { timeout: 20_000 }),
    submitRegisterForm(page, { username: `ffo${id}`.slice(0, 30), email, password: 'e2epass123' }),
  ])
  expect((await body).postDataJSON().invitedBy).toBe(me.code)

  // Stored as the household's referral (D-121), when this run has the test database.
  let url: string | null = null
  try {
    url = testDatabaseUrl()
  } catch {
    // Not a local database: only read from the CI/local one.
  }
  if (url) {
    const { Client } = createRequire(path.join(__dirname, '..', '..', 'api', 'package.json'))('pg')
    const c = new Client({ connectionString: url })
    await c.connect()
    try {
      const { rows } = await c.query('SELECT invited_by_code FROM users WHERE email = $1', [email])
      expect(rows[0]?.invited_by_code).toBe(me.code)
    } finally {
      await c.end()
    }
  }
  await ctx.close()
})

test('/i/<campaign code> still opens /register with the campaign', async ({ page }) => {
  await page.goto('/i/nocampaign1')
  await expect(page).toHaveURL(/\/register\?campana=nocampaign1$/)
})
