/**
 * Smoke (real Postgres) for PRO-334, the Sean Ellis survey: the store's SQL
 * (sign-up age, menu, active days, children, housemates, WhatsApp) and once
 * per person (claim and answer).
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/seanEllisSurvey.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { householdMembers, households, menus, usageEvents, userFeedback, users, whatsappLinks } from '../db/schema.js'
import { SEAN_ELLIS_TAG, createDbSeanEllisStore, seanEllisChannel } from '../services/seanEllisSurvey.js'

const tag = `se${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const DAY = 24 * 60 * 60 * 1000
// During the beta (before 2026-12-15), whatever day the smoke runs.
const NOW = new Date('2026-11-12T10:00:00Z')
const RULES = { now: NOW, adminEmails: [], testDomains: [] }

let i = 0
async function person(opts: { ageDays?: number; menu?: boolean; activeDaysAgo?: number[]; child?: boolean; inboundHoursAgo?: number } = {}) {
  i++
  const [u] = await db
    .insert(users)
    .values({ username: `${tag}${i}`, email: `${tag}${i}@example.org`, passwordHash: 'x', createdAt: new Date(NOW.getTime() - (opts.ageDays ?? 20) * DAY) })
    .returning({ id: users.id })
  const [h] = await db.insert(households).values({ ownerId: u.id }).returning({ id: households.id })
  await db.insert(householdMembers).values({ householdId: h.id, userId: u.id, role: opts.child ? 'child' : 'owner' })
  if (opts.menu ?? true) await db.insert(menus).values({ userId: u.id, householdId: h.id, weekStart: '2026-11-09', days: [] })
  for (const d of opts.activeDaysAgo ?? [1, 3]) {
    await db.insert(usageEvents).values({ userId: u.id, householdId: h.id, name: 'menu_viewed', createdAt: new Date(NOW.getTime() - d * DAY) })
  }
  if (opts.inboundHoursAgo !== undefined) {
    const phone = `34${String(Date.now()).slice(-6)}${i}${Math.floor(Math.random() * 100)}`
    await db.insert(whatsappLinks).values({ userId: u.id, phone, lastInboundAt: new Date(NOW.getTime() - opts.inboundHoursAgo * 3600_000) })
  }
  return u.id
}

describe.skipIf(!reachable)('encuesta de Sean Ellis (PRO-334)', () => {
  it('reads who is due and where, and files the answer once', async () => {
    const store = createDbSeanEllisStore(db)
    const channel = async (id: string) => seanEllisChannel((await store.load(id, NOW))!, RULES)

    const web = await person()
    const wa = await person({ inboundHoursAgo: 2 })
    expect(await channel(web)).toBe('web')
    expect(await channel(wa)).toBe('whatsapp')
    expect(await channel(await person({ ageDays: 10 }))).toBeNull()
    expect(await channel(await person({ menu: false }))).toBeNull()
    expect(await channel(await person({ activeDaysAgo: [1] }))).toBeNull()
    expect(await channel(await person({ activeDaysAgo: [1, 20] }))).toBeNull()
    expect(await channel(await person({ child: true }))).toBeNull()

    // WhatsApp: asked once.
    expect(await store.claim(wa, NOW)).toBe(true)
    expect(await store.claim(wa, NOW)).toBe(false)
    expect(await channel(wa)).toBeNull()

    // The card: answered once, then gone.
    expect(await store.saveAnswer(web, { channel: 'app', answer: 'muy', text: 'Muy decepcionado/a' }, NOW)).toBe(true)
    expect(await store.saveAnswer(web, { channel: 'app', answer: 'nada', text: 'Nada' }, NOW)).toBe(false)
    expect(await channel(web)).toBeNull()
    const rows = await db
      .select({ tag: userFeedback.tag, answer: userFeedback.answer, channel: userFeedback.channel })
      .from(userFeedback)
      .where(and(eq(userFeedback.userId, web), eq(userFeedback.tag, SEAN_ELLIS_TAG)))
    expect(rows).toEqual([{ tag: 'sean_ellis', answer: 'muy', channel: 'app' }])
  })
})
