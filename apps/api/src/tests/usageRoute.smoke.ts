/**
 * Smoke test for product analytics (specs/metrics.md "Eventos de uso") and
 * the anonymised conversation flags (specs/whatsapp.md) against a running API
 * + Postgres: a fresh account's signup, onboarding, first menu, shopping list
 * and first-steps answer land in `usage_events` and come back as counts in
 * GET /admin/usage; the flags endpoint answers with its shape; the read-only
 * token never writes.
 *
 *   API_URL=http://localhost:8790 METRICS_READ_TOKEN=… pnpm --filter @ona/api exec vitest run src/tests/usageRoute.smoke.ts
 *
 * Needs REGISTRATION_MODE=open on that API (CI's smoke job sets it) and
 * METRICS_READ_TOKEN on both sides; skips when the API isn't reachable.
 */
import { describe, expect, it } from 'vitest'
import { API_URL, reachable } from './smokeEnv.js'

const METRICS_TOKEN = process.env.METRICS_READ_TOKEN ?? ''
const tag = `usage_${Date.now()}${Math.random().toString(36).slice(2, 6)}`

async function call(method: string, path: string, payload?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: r.status, body }
}

const metrics = { 'x-metrics-token': METRICS_TOKEN }

describe.skipIf(!reachable || !METRICS_TOKEN)('usage events + conversation flags smoke', () => {
  it('records a new household’s first steps and reports them as counts only', async () => {
    const before = await call('GET', '/admin/usage?days=1', undefined, metrics)
    expect(before.status).toBe(200)
    // PRO-156: reply rate to Mimo's own messages and BAJA, counts only.
    expect(before.body.proactive).toMatchObject({ replyWindowHours: 6, totals: { sent: expect.any(Number), optouts: expect.any(Number) } })
    expect(Array.isArray(before.body.proactive.weekly)).toBe(true)
    const count = (r: any, name: string) => Number(r.body.totals.events[name] ?? 0)

    const reg = await call('POST', '/register', { username: tag, email: `${tag}@test.local`, password: 'e2epass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    const auth = { Authorization: `Bearer ${reg.body.token}` }
    const userId = reg.body.user.id

    const onboarding = await call('POST', `/user/${userId}/onboarding`, { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], favoriteDishes: ['lentejas'], priority: 'varied' }, auth)
    expect(onboarding.status).toBe(200)
    const now = new Date()
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)))
    const gen = await call('POST', '/menu/generate', { userId, weekStart: monday.toISOString().slice(0, 10) }, auth)
    expect([200, 201]).toContain(gen.status)
    expect((await call('GET', '/shopping-list', undefined, auth)).status).toBe(200)
    expect((await call('POST', `/user/${userId}/first-steps`, { outcome: 'skipped' }, auth)).status).toBe(200)
    // The assistant's loopback marker: not counted as a web view.
    expect((await call('GET', '/shopping-list', undefined, { ...auth, 'x-mimoia-internal': '1' })).status).toBe(200)

    // Inserts are fire-and-forget: poll briefly.
    let after: any = null
    for (let i = 0; i < 20; i++) {
      after = await call('GET', '/admin/usage?days=1', undefined, metrics)
      if (count(after, 'first_steps_skipped') > count(before, 'first_steps_skipped')) break
      await new Promise((r) => setTimeout(r, 250))
    }
    expect(after.status).toBe(200)
    for (const name of ['signup_completed', 'onboarding_completed', 'menu_generated', 'first_steps_skipped']) {
      expect(count(after, name) - count(before, name), name).toBe(1)
    }
    expect(count(after, 'shopping_list_viewed') - count(before, 'shopping_list_viewed')).toBe(1)

    const today = after.body.daily.at(-1)
    expect(today.day).toBe(after.body.to)
    expect(today.activeHouseholds).toBeGreaterThanOrEqual(1)
    expect(after.body.funnel.at(-1).signups).toBeGreaterThanOrEqual(1)
    // PRO-106: households snapshot (the new household counts) and the weekly channel split.
    expect(after.body.households.households).toBeGreaterThanOrEqual(1)
    expect(after.body.households).toEqual(
      expect.objectContaining({ withWhatsapp: expect.any(Number), withNotices: expect.any(Number), withTwoPlusMembers: expect.any(Number) }),
    )
    expect(after.body.channelSplit.at(-1).webOnly).toBeGreaterThanOrEqual(1)
    // PRO-263: household invitations per moment (real SQL on source / shared_at / consumed_at).
    expect(Object.keys(after.body.familyInvites.bySource).sort()).toEqual(['alta', 'casa', 'compra', 'mimo'])
    expect(after.body.familyInvites.totals).toEqual(
      expect.objectContaining({ prepared: expect.any(Number), sent: expect.any(Number), accepted: expect.any(Number) }),
    )
    expect(after.body.familyInvites.goal.withTwoPlusAdults).toEqual(expect.any(Number))
    // Counts only: no ids, usernames or emails anywhere in the payload.
    const raw = JSON.stringify(after.body)
    expect(raw).not.toContain(userId)
    expect(raw).not.toContain(tag)
  }, 90_000)

  it('counts installed-app opens once per household and day, by device, in /admin/metrics (PRO-83)', async () => {
    const t = `${tag}i`
    const reg = await call('POST', '/register', { username: t, email: `${t}@test.local`, password: 'e2epass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    const android = { Authorization: `Bearer ${reg.body.token}`, 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/129 Mobile' }
    const androidOf = (r: any) => Number(r.body.weekly.at(-1).installedAppHouseholds.android)
    const before = await call('GET', '/admin/metrics?weeks=1', undefined, metrics)
    expect(before.status).toBe(200)
    for (let i = 0; i < 3; i++) expect((await call('POST', '/usage/app-opened', undefined, android)).status).toBe(204)
    expect((await call('POST', '/usage/app-opened')).status).toBe(401)
    const after = await call('GET', '/admin/metrics?weeks=1', undefined, metrics)
    expect(androidOf(after) - androidOf(before)).toBe(1)
    const usage = await call('GET', '/admin/usage?days=1', undefined, metrics)
    expect(JSON.stringify(usage.body)).not.toContain('Pixel 8')
    expect(after.body.weekly.at(-1).pushEnabledHouseholds).toEqual(
      expect.objectContaining({ android: expect.any(Number), ios: expect.any(Number), desktop: expect.any(Number), total: expect.any(Number) }),
    )
    // PRO-216: the weekly aviso budget block (real SQL against notice_candidates).
    expect(after.body.notifications.enabledHouseholdsNow).toEqual(
      expect.objectContaining({ whatsapp: expect.any(Number), push: expect.any(Number), total: expect.any(Number) }),
    )
    expect(after.body.notifications.weekly.at(-1)).toEqual(
      expect.objectContaining({ candidates: expect.any(Number), droppedByBudget: expect.any(Number), priority1Dropped: expect.any(Number) }),
    )
  }, 30_000)

  it('counts active households by the system of their last browser, only the word (PRO-307)', async () => {
    const t = `${tag}s`
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
    const before = await call('GET', '/admin/usage?days=1', undefined, metrics)
    expect(before.body.householdsBySystem).toEqual(
      expect.objectContaining({ android: expect.any(Number), ios: expect.any(Number), desktop: expect.any(Number), unknown: expect.any(Number), total: expect.any(Number) }),
    )
    const reg = await call('POST', '/register', { username: t, email: `${t}@test.local`, password: 'e2epass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    const auth = { Authorization: `Bearer ${reg.body.token}`, 'User-Agent': iphone }
    // screen_viewed is passive: the shopping list makes the household active, the screen view gives its system.
    expect((await call('GET', '/shopping-list', undefined, auth)).status).toBe(200)
    expect((await call('POST', '/usage/event', { name: 'screen_viewed', props: { screen: 'menu' } }, auth)).body).toEqual({ counted: true })
    let after: any = null
    for (let i = 0; i < 20; i++) {
      after = await call('GET', '/admin/usage?days=1', undefined, metrics)
      if (after.body.householdsBySystem.ios > before.body.householdsBySystem.ios) break
      await new Promise((r) => setTimeout(r, 250))
    }
    expect(after.body.householdsBySystem.ios - before.body.householdsBySystem.ios).toBe(1)
    const s = after.body.householdsBySystem
    expect(s.android + s.ios + s.desktop + s.unknown).toBe(s.total)
    expect(JSON.stringify(after.body)).not.toMatch(/iPhone OS|Mozilla/)
  }, 30_000)

  it('serves the conversation flags to the token: categories and severity, no reply or note', async () => {
    const r = await call('GET', '/admin/assistant-reviews/flags?days=3', undefined, metrics)
    expect(r.status).toBe(200)
    expect(r.body.channels).toEqual(['whatsapp'])
    expect(Object.keys(r.body.counts.byCategory).sort()).toEqual(['error_refusal', 'health_claim', 'health_talk', 'other', 'unverified_done'])
    expect(Array.isArray(r.body.items)).toBe(true)
    for (const i of r.body.items) expect(Object.keys(i).sort()).toEqual(['category', 'channel', 'date', 'reviewerCategory', 'severity', 'source'])
  })

  it('the read-only token never writes, and opens nothing else', async () => {
    expect((await call('POST', '/admin/assistant-reviews/run', {}, metrics)).status).toBe(401)
    expect((await call('POST', '/admin/usage', {}, metrics)).status).not.toBe(200)
    expect((await call('GET', '/admin/assistant-reviews', undefined, metrics)).status).toBe(401)
  })
})
