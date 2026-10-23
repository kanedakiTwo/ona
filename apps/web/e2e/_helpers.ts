/**
 * Shared helpers for the Playwright E2E suite.
 */

import { expect, type Locator, type Page } from '@playwright/test'
import { pinnedDay } from './_clock'

/** Unique-per-run identifier — keeps DB state from colliding between specs. */
export function uniqueId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Fill a controlled form and keep re-filling until its submit button enables.
 *
 * `next dev` serves the SSR HTML before React has hydrated. A `fill()` that
 * lands in that window sets the DOM value but not React state, so the
 * auth forms (whose submit is `disabled` while any field is empty) stay
 * disabled forever — the spec then dies on a 30 s click timeout. Re-filling
 * until React reflects the values makes the step deterministic instead of
 * timing-dependent.
 */
export async function fillUntilEnabled(
  submit: Locator,
  fill: () => Promise<void>,
  timeout = 15_000,
): Promise<void> {
  await expect(async () => {
    await fill()
    await expect(submit).toBeEnabled({ timeout: 1_000 })
  }).toPass({ timeout })
}

export interface TestCreds {
  username: string
  email: string
  password: string
}

export function freshCreds(): TestCreds {
  const id = uniqueId()
  const username = `e2e_${id}`
  return { username, email: `${username}@test.local`, password: 'e2epass123' }
}

/**
 * Fill /register (already loaded) and click "Crear cuenta". Does not wait
 * for the redirect — callers assert where they expect to land.
 *
 * Inputs are targeted by position/type (the first input is the username),
 * which keeps working whatever the labels say.
 */
export async function submitRegisterForm(page: Page, creds: TestCreds): Promise<void> {
  // Closed beta (PRO-27): sign up through the e2e campaign link (global-setup.ts).
  await useE2ECampaign(page)
  const form = page.locator('form')
  const submit = form.getByRole('button', { name: /^crear cuenta/i })
  await fillUntilEnabled(submit, async () => {
    await form.locator('input').nth(0).fill(creds.username)
    await form.locator('input[type="email"]').fill(creds.email)
    await form.locator('input[type="password"]').fill(creds.password)
    await form.getByRole('checkbox', { name: 'Tengo 14 años o más' }).check()
  })
  await submit.click()
}

/** Fill /login (already loaded) and click "Entrar". */
export async function submitLoginForm(page: Page, creds: Pick<TestCreds, 'username' | 'password'>): Promise<void> {
  const form = page.locator('form')
  const submit = form.getByRole('button', { name: /^entrar/i })
  await fillUntilEnabled(submit, async () => {
    await form.locator('input').nth(0).fill(creds.username)
    await form.locator('input[type="password"]').fill(creds.password)
  })
  await submit.click()
}

/**
 * Generate a fresh test user and register them via the UI.
 *
 * New accounts get the «Primeros pasos» guide over /menu (PRO-07). It would
 * cover the screen in every spec that isn't about it, so it is marked as
 * seen here; `first-steps.spec.ts` passes `{ keepFirstSteps: true }`.
 */
export async function registerFreshUser(
  page: Page,
  opts: { keepFirstSteps?: boolean; keepTaste?: boolean } = {},
): Promise<TestCreds> {
  const creds = freshCreds()
  await page.goto('/register')
  await Promise.all([
    page.waitForURL(/\/onboarding|\/menu/, { timeout: 20_000 }),
    submitRegisterForm(page, creds),
  ])
  if (!opts.keepFirstSteps) await skipFirstSteps(page)
  if (!opts.keepTaste) await skipTasteOffer(page)
  return creds
}

/**
 * «Afina tu menú» (PRO-146) comes first in the sign-up and, for accounts
 * onboarded without it, as a full-screen «Novedad» over /menu. Every spec
 * that isn't about it marks the sign-up step as already shown (same endpoint
 * the sign-up step calls), which turns both off; `afina-tu-menu.spec.ts`
 * passes `{ keepTaste: true }`. Specs that reach /onboarding must navigate
 * there after this (they all `page.goto('/onboarding')`).
 */
export async function skipTasteOffer(page: Page): Promise<void> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:8765'
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  if (!token) return
  const res = await page.request.post(`${apiUrl}/taste/offers`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { event: 'onboarding' },
  })
  if (!res.ok()) throw new Error(`taste offer failed: ${res.status()} ${await res.text()}`)
}

/**
 * Mark the «Primeros pasos» guide (PRO-07) as seen for the logged-in user,
 * through the same endpoint the guide's "Saltar" calls.
 */
export async function skipFirstSteps(page: Page): Promise<void> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:8765'
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userRaw = await page.evaluate(() => localStorage.getItem('ona_user'))
  if (!token || !userRaw) return
  const userId = JSON.parse(userRaw).id as string
  const res = await page.request.post(`${apiUrl}/user/${userId}/first-steps`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok()) throw new Error(`first-steps failed: ${res.status()} ${await res.text()}`)
}

/**
 * Skip onboarding by hitting the API directly with a sane default body. The
 * onboarding page is a 5-step form with option-button-driven steps that
 * each auto-advance on click — automating it through the UI is brittle and
 * slow. The dedicated `registration-onboarding.spec.ts` exercises the UI
 * surface (it just asserts we land somewhere valid); every other spec uses
 * this helper to skip ahead to `/menu` reliably.
 */
export async function completeOnboarding(
  page: Page,
  opts: { keepFirstSteps?: boolean; keepTaste?: boolean } = {},
): Promise<void> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:8765'

  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userRaw = await page.evaluate(() => localStorage.getItem('ona_user'))
  if (!token || !userRaw) return
  const userId = JSON.parse(userRaw).id as string

  const res = await page.request.post(`${apiUrl}/user/${userId}/onboarding`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      adults: 1,
      kidsCount: 0,
      cookingFreq: 'daily',
      restrictions: [],
      priority: 'healthy',
    },
  })
  // Fail loudly: this used to send a stale payload and get a silent 400.
  if (!res.ok()) throw new Error(`onboarding failed: ${res.status()} ${await res.text()}`)
  // Specs that sign up without registerFreshUser (closed-beta) land here.
  if (!opts.keepFirstSteps) await skipFirstSteps(page)
  if (!opts.keepTaste) await skipTasteOffer(page)

  // Reflect onboardingDone in the local copy so AuthProvider doesn't bounce
  // us back to /onboarding on the next navigation.
  await page.evaluate(() => {
    const raw = localStorage.getItem('ona_user')
    if (!raw) return
    const u = JSON.parse(raw)
    u.onboardingDone = true
    localStorage.setItem('ona_user', JSON.stringify(u))
  })

  await page.goto('/menu')
}

/**
 * Closed beta (PRO-27): the register form takes the campaign code from
 * `?campana=` or, after a detour, from sessionStorage. Put the e2e campaign
 * there so any /register (with or without ?next=) signs up through it.
 */
export async function useE2ECampaign(page: Page): Promise<void> {
  const code = process.env.E2E_CAMPAIGN_CODE
  if (!code) return
  await page.evaluate((c) => sessionStorage.setItem('ona.campana', c), code)
}

/** Body extras for API-level `POST /register` calls in specs. */
export function e2eInvite(): { inviteCode?: string } {
  return process.env.E2E_CAMPAIGN_CODE ? { inviteCode: process.env.E2E_CAMPAIGN_CODE } : {}
}

type WeekMenu = { id: string; days: Record<string, { dishes?: { kind: string; recipeId?: string }[] } | undefined>[] }

/**
 * Add `meal` to `day` with a recipe (the slot must be absent or empty). The
 * API leaves it empty when its matcher finds nothing — the small CI
 * catalogue runs out of free recipes — so then pin one of the week's.
 */
export async function addMealWithRecipe(
  page: Page,
  headers: Record<string, string>,
  menu: WeekMenu,
  day: number,
  meal: string,
) {
  const apiUrl = process.env.API_URL ?? 'http://localhost:8765'
  const url = `${apiUrl}/menu/${menu.id}/day/${day}/meal/${meal}`
  const r = await page.request.post(url, { headers })
  if (r.ok()) {
    const after = (await r.json()) as WeekMenu
    if (after.days[day]?.[meal]?.dishes?.some((d) => d.kind === 'recipe')) return r
  }
  const recipeId = menu.days
    .flatMap((d) => Object.values(d ?? {}))
    .flatMap((s) => s?.dishes ?? [])
    .find((d) => d.kind === 'recipe')?.recipeId
  return page.request.post(url, { headers, data: { recipeId } })
}

/**
 * Generate the pinned week's menu (`pinnedDay()`) so that the shopping list
 * from the pinned day has rows at any hour: a recipe on the pinned day and,
 * at dinner, one on the day after.
 *
 * Why two days: `pinClock` pins the browser, not the API, and
 * `GET /shopping-list` drops the meals of the API's real «today» that are
 * already past (lunch from 16:00, dinner from 23:00 Madrid). On a real
 * Friday evening — Friday is the default pinned day — a list whose only dish
 * was Friday's lunch came back empty and the /shopping specs failed (CI red
 * from 16:00 Madrid on 2026-10-23). The API trims one date only, so with
 * dishes on two days of the range one always survives. With
 * `E2E_WEEKDAY=6` (Sunday) there is no day after in the week, so the dinner
 * goes on the pinned day itself.
 */
export async function generateWeekWithListRows(page: Page) {
  const apiUrl = process.env.API_URL ?? 'http://localhost:8765'
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user'))) ?? '{}')
  const day = pinnedDay()
  const { weekStart, dayIdx } = day
  const headers = { Authorization: `Bearer ${token}` }
  const res = await page.request.post(`${apiUrl}/menu/generate`, { headers, data: { userId: user.id, weekStart } })
  expect(res.ok(), `menu/generate ${res.status()}`).toBeTruthy()

  const getMenu = async () => (await (await page.request.get(`${apiUrl}/menu/${user.id}/${weekStart}`, { headers })).json()) as WeekMenu
  const hasRecipe = (menu: WeekMenu, d: number, meal?: string) =>
    Object.entries(menu.days?.[d] ?? {}).some(
      ([key, slot]) => (!meal || key === meal) && !!slot?.dishes?.some((dish) => dish.kind === 'recipe'),
    )
  const ensure = async (menu: WeekMenu, d: number, meal: string) => {
    if (menu.days?.[d]?.[meal]) await page.request.delete(`${apiUrl}/menu/${menu.id}/day/${d}/meal/${meal}`, { headers })
    const add = await addMealWithRecipe(page, headers, menu, d, meal)
    expect(add.ok(), `add ${meal} on day ${d}: ${add.status()}`).toBeTruthy()
  }

  let menu = await getMenu()
  if (!hasRecipe(menu, dayIdx)) {
    await ensure(menu, dayIdx, 'lunch')
    menu = await getMenu()
  }
  const next = dayIdx < 6 ? dayIdx + 1 : dayIdx
  if (!hasRecipe(menu, next, 'dinner')) await ensure(menu, next, 'dinner')
  return day
}

/**
 * A finger swipe from `from` to `to` (CDP touch events, so the page sees
 * pointerType "touch"). The section swipe (SwipeNavigator) answers only to
 * touch and pen since 2026-10-21: a mouse drag is a text selection or a slip,
 * not a swipe. Chromium only.
 */
export async function touchSwipe(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12,
): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] })
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps
    const y = from.y + ((to.y - from.y) * i) / steps
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}
