/**
 * Smoke (real API + Postgres) for PRO-205, the «Afina tu menú» notice: who
 * gets it (a verdict before the fix + allergies or diet in the household),
 * once per household, WhatsApp recipient vs app only, and the app card's
 * routes.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/afinaNotice.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { householdNotices, users, whatsappLinks } from '../db/schema.js'
import { AFINA_NOTICE_KEY, createDbNoticeRepo, noticeVisibleInApp } from '../services/afinaNotice.js'

const tag = `afn${Date.now()}${Math.random().toString(36).slice(2, 6)}`

async function call(method: string, path: string, token?: string, payload?: unknown) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

async function user(i: number, opts: { restrictions?: string[]; rate?: boolean }) {
  const u = `${tag}${i}`
  const reg = await call('POST', '/register', undefined, { username: u, email: `${u}@test.local`, password: 'e2epass123', ageConfirmed: true })
  expect(reg.status, JSON.stringify(reg.body)).toBe(201)
  const token = reg.body.token as string
  const id = reg.body.user.id as string
  const restrictions = opts.restrictions ?? []
  const ob = await call('POST', `/user/${id}/onboarding`, token, { adults: 1, kidsCount: 0, cookingFreq: 'daily', restrictions, healthConsent: restrictions.length > 0, priority: 'varied' })
  expect(ob.status).toBe(200)
  if (opts.rate) {
    const next = await call('GET', '/taste/next?limit=1', token)
    expect((await call('POST', '/taste', token, { recipeId: next.body.cards[0].recipeId, verdict: 'like' })).status).toBe(200)
  }
  const [row] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, id))
  return { id, token, householdId: row.householdId! }
}

const noticeOf = async (key: string, householdId: string) =>
  (await db.select().from(householdNotices).where(and(eq(householdNotices.key, key), eq(householdNotices.householdId, householdId))))[0]

describe.skipIf(!reachable)('«Afina tu menú» notice (PRO-205)', () => {
  it('only households with a verdict before the fix and a restriction; once each', async () => {
    const coeliac = await user(1, { restrictions: ['Sin gluten'], rate: true })
    const linked = await user(2, { restrictions: ['Vegetariano'], rate: true })
    await db.insert(whatsappLinks).values({ userId: linked.id, phone: `34${String(Date.now()).slice(-9)}`, notify: true })
    const noRestriction = await user(3, { rate: true })
    const noVerdict = await user(4, { restrictions: ['Sin gluten'] })
    await new Promise((r) => setTimeout(r, 50))
    const cutoff = new Date()
    const afterFix = await user(5, { restrictions: ['Sin gluten'], rate: true })

    const key = `test_${tag}`
    const repo = createDbNoticeRepo(db)
    expect(await repo.scan(key, cutoff)).toBe(true)
    expect(await repo.scan(key, new Date())).toBe(false) // never twice

    const a = await noticeOf(key, coeliac.householdId)
    expect(a).toBeTruthy()
    expect(a.userId).toBeNull() // no WhatsApp → the app, straight away
    expect(noticeVisibleInApp(a as any, new Date())).toBe(true)
    const b = await noticeOf(key, linked.householdId)
    expect(b.userId).toBe(linked.id) // Mimo on WhatsApp first
    expect(b.appSince).toBeNull()
    expect(await noticeOf(key, noRestriction.householdId)).toBeUndefined()
    expect(await noticeOf(key, noVerdict.householdId)).toBeUndefined()
    expect(await noticeOf(key, afterFix.householdId)).toBeUndefined()
    const all = await db.select().from(householdNotices).where(and(eq(householdNotices.key, key), eq(householdNotices.householdId, coeliac.householdId)))
    expect(all).toHaveLength(1)
    await db.delete(whatsappLinks).where(eq(whatsappLinks.userId, linked.id))
  }, 60_000)

  it('the card: GET shows it with Legal’s text, «Entendido» closes it for good', async () => {
    const u = await user(6, { restrictions: ['Sin gluten'], rate: true })
    expect((await call('GET', '/notices/afina', u.token)).body).toEqual({ show: false })
    await db.insert(householdNotices).values({ key: AFINA_NOTICE_KEY, householdId: u.householdId, appSince: new Date() }).onConflictDoNothing()
    const shown = await call('GET', '/notices/afina', u.token)
    expect(shown.body.show).toBe(true)
    expect(shown.body.text).toMatch(/^¡Hola! Un aviso rápido/)
    expect((await call('POST', '/notices/afina/dismiss', u.token)).status).toBe(200)
    expect((await call('GET', '/notices/afina', u.token)).body).toEqual({ show: false })
    expect((await call('GET', '/notices/afina')).status).toBe(401)
  }, 60_000)
})
