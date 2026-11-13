/**
 * Smoke (real Postgres) for PRO-1197, «Pregunta por correo»:
 *   - the group's SQL (days without activity, suspended, BAJA, test emails, the waitlist name);
 *   - never twice to a household (unique question + household).
 *
 * Other tests' households live in the same database, so this one only looks
 * at its own (the store's candidates filtered to them).
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/emailQuestion.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { emailQuestionSends, householdMembers, households, usageEvents, users, waitlistEntries, whatsappLinks } from '../db/schema.js'
import { createDbEmailQuestionStore, previewEmailQuestion, sendEmailQuestion, type EmailQuestionDeps, type EmailQuestionStore } from '../services/emailQuestion.js'
import type { EmailMessage } from '../services/email.js'

const tag = `pc${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const DAY = 24 * 60 * 60 * 1000
const NOW = new Date()

const BODY = 'Una línea de prueba para el cuerpo del correo, lo bastante larga para pasar el mínimo.'

let i = 0
async function home(opts: { email?: string; baja?: boolean; suspended?: boolean; activeDaysAgo?: number; createdDaysAgo?: number; waitlistName?: string } = {}) {
  i++
  const email = opts.email ?? `${tag}${i}@example.org`
  const [u] = await db
    .insert(users)
    .values({ username: `${tag}${i}`, email, passwordHash: 'x', suspendedAt: opts.suspended ? NOW : null })
    .returning({ id: users.id })
  const [h] = await db
    .insert(households)
    .values({ ownerId: u.id, createdAt: new Date(NOW.getTime() - (opts.createdDaysAgo ?? 60) * DAY) })
    .returning({ id: households.id })
  await db.insert(householdMembers).values({ householdId: h.id, userId: u.id, role: 'owner' })
  if (opts.baja) {
    await db.insert(whatsappLinks).values({ userId: u.id, phone: `34${String(Date.now()).slice(-6)}${i}`, notify: false, optInDeclinedAt: NOW })
  }
  if (opts.activeDaysAgo !== undefined) {
    await db.insert(usageEvents).values({ userId: u.id, householdId: h.id, name: 'menu_generated', createdAt: new Date(NOW.getTime() - opts.activeDaysAgo * DAY) })
  }
  if (opts.waitlistName) {
    await db.insert(waitlistEntries).values({
      email,
      firstName: opts.waitlistName,
      householdSize: '2',
      plannerRole: 'yo',
      currentMethod: 'lista',
      platform: 'ios',
      referralCode: `${tag}${i}`.slice(-16),
      consentVersion: 'smoke',
      consentAt: NOW,
      unsubscribeToken: `pc-smoke-${tag}-${i}-token`,
    })
  }
  return { userId: u.id, householdId: h.id, email }
}

describe.skipIf(!reachable)('pregunta por correo (PRO-1197)', () => {
  it('counts the households that left, sends once per household, never twice', async () => {
    const a = await home({ activeDaysAgo: 20, waitlistName: 'lucía' })
    const b = await home()
    await home({ activeDaysAgo: 2 })
    await home({ createdDaysAgo: 3 })
    await home({ baja: true })
    await home({ suspended: true })
    await home({ email: `${tag}@example.com` })

    const real = createDbEmailQuestionStore(db)
    const mine = new Set<string>()
    const store: EmailQuestionStore = {
      ...real,
      loadCandidates: async () => (await real.loadCandidates()).filter((h) => h.members.some((m) => m.email.startsWith(tag))),
      sentHouseholds: async () => new Set([...(await real.sentHouseholds())].filter((id) => mine.has(id))),
    }
    for (const h of await store.loadCandidates()) mine.add(h.householdId)
    expect(mine.size).toBe(7)

    const sent: EmailMessage[] = []
    const deps: EmailQuestionDeps = {
      store,
      configured: true,
      adminEmails: [],
      testDomains: ['example.com'],
      pause: async () => {},
      send: async (msg) => {
        sent.push(msg)
        return { status: 'sent', id: null }
      },
    }

    const preview = await previewEmailQuestion(deps)
    expect(preview.count).toBe(2)
    expect(preview.excluded).toMatchObject({ activo: 2, baja: 1, suspendida: 1, prueba: 1, ya_enviada: 0 })
    expect(preview.recipients.find((r) => r.householdId === a.householdId)?.firstName).toBe('Lucía')

    expect(await sendEmailQuestion(BODY, 2, deps)).toMatchObject({ status: 'sent', sent: 2, failed: 0 })
    expect(sent.map((m) => m.to).sort()).toEqual([a.email, b.email].sort())

    // Again: nobody left; the unique index refuses a second row for the household.
    expect(await sendEmailQuestion(BODY, 2, deps)).toEqual({ status: 'count_changed', count: 0 })
    expect(sent).toHaveLength(2)
    expect(await real.claimSend({ householdId: a.householdId, userId: a.userId, email: a.email, firstName: null })).toBeNull()
    const rows = await db.select({ status: emailQuestionSends.status }).from(emailQuestionSends).where(eq(emailQuestionSends.householdId, a.householdId))
    expect(rows).toEqual([{ status: 'sent' }])
  })
})
