/**
 * Smoke (real Postgres) for PRO-1091, «Pregunta única por WhatsApp»:
 *   - the group's SQL (sign-up dates, days without activity, BAJA, test emails);
 *   - never twice to a household (unique question + household);
 *   - the next message after it lands in Opiniones, tag `pregunta_unica`, once.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/oneOffQuestion.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { householdMembers, households, usageEvents, userFeedback, users, whatsappLinks, whatsappMessages } from '../db/schema.js'
import {
  createDbQuestionStore,
  previewQuestion,
  recordQuestionAnswer,
  sendQuestion,
  type QuestionDeps,
} from '../services/whatsapp/oneOffQuestion.js'

const tag = `pq${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const DAY = 24 * 60 * 60 * 1000
const NOW = new Date()
// A sign-up day of its own (in the past), so other tests' households stay out of the group.
const SIGNUP_DAY = `19${50 + Math.floor(Math.random() * 40)}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`
const FILTER = { signedUpFrom: SIGNUP_DAY, signedUpTo: SIGNUP_DAY, inactiveDays: 7 }
const TEXT = `¿Qué os cuesta más de planificar la semana? ${tag}`

let i = 0
async function home(opts: { email?: string; link?: 'on' | 'baja' | 'none'; activeDaysAgo?: number } = {}) {
  i++
  const [u] = await db
    .insert(users)
    .values({ username: `${tag}${i}`, email: opts.email ?? `${tag}${i}@example.org`, passwordHash: 'x' })
    .returning({ id: users.id })
  const [h] = await db.insert(households).values({ ownerId: u.id, createdAt: new Date(`${SIGNUP_DAY}T12:00:00Z`) }).returning({ id: households.id })
  await db.insert(householdMembers).values({ householdId: h.id, userId: u.id, role: 'owner' })
  const phone = `34${String(Date.now()).slice(-6)}${i}${Math.floor(Math.random() * 100)}`
  if ((opts.link ?? 'on') !== 'none') {
    const baja = opts.link === 'baja'
    await db.insert(whatsappLinks).values({ userId: u.id, phone, notify: !baja, optInDeclinedAt: baja ? NOW : null })
  }
  if (opts.activeDaysAgo !== undefined) {
    await db.insert(usageEvents).values({ userId: u.id, householdId: h.id, name: 'menu_generated', createdAt: new Date(NOW.getTime() - opts.activeDaysAgo * DAY) })
  }
  return { userId: u.id, householdId: h.id, phone }
}

describe.skipIf(!reachable)('pregunta única por WhatsApp (PRO-1091)', () => {
  it('counts the group, sends once per household, keeps BAJA out and files the answer in Opiniones', async () => {
    const a = await home({ activeDaysAgo: 20 })
    const b = await home()
    await home({ link: 'baja' })
    await home({ email: `${tag}@example.com` })
    await home({ activeDaysAgo: 1 })
    await home({ link: 'none' })

    const store = createDbQuestionStore(db)
    const sent: string[] = []
    const deps: QuestionDeps = {
      store,
      now: NOW,
      template: 'mimoia_pregunta_unica',
      configured: true,
      isPaused: async () => false,
      // Every home here is a test address; only example.com plays «hogar de prueba».
      adminEmails: [],
      testDomains: ['example.com'],
      sendTemplate: async (phone) => {
        sent.push(phone)
        return null
      },
      recordOutbound: async (row) => {
        await db.insert(whatsappMessages).values({ phone: row.phone, userId: row.userId, direction: 'out', kind: 'pregunta_unica', body: row.body, status: row.status })
      },
    }

    const preview = await previewQuestion(TEXT, FILTER, deps)
    expect(preview.count).toBe(2)
    expect(preview.excluded).toMatchObject({ baja: 1, prueba: 1, sin_whatsapp: 1, ya_enviada: 0 })

    expect(await sendQuestion(TEXT, FILTER, 2, a.userId, deps)).toMatchObject({ status: 'sent', sent: 2, failed: 0 })
    expect(sent.sort()).toEqual([a.phone, b.phone].sort())

    // Again: nobody left; the unique index refuses a second row for the household.
    expect((await previewQuestion(TEXT, FILTER, deps)).count).toBe(0)
    const questionId = await store.ensureQuestion(TEXT, a.userId)
    expect(await store.claimSend(questionId, { householdId: a.householdId, userId: a.userId, phone: a.phone })).toBeNull()

    // The answer: the next message, once.
    expect(await recordQuestionAnswer(a.userId, 'Decidir qué cenamos entre semana', db, new Date())).toBe(true)
    expect(await recordQuestionAnswer(a.userId, '¿Qué cenamos hoy?', db, new Date())).toBe(false)
    const fb = await db.select({ text: userFeedback.text, tag: userFeedback.tag, channel: userFeedback.channel }).from(userFeedback).where(eq(userFeedback.userId, a.userId))
    expect(fb).toEqual([{ text: 'Decidir qué cenamos entre semana', tag: 'pregunta_unica', channel: 'whatsapp' }])

    // Mimo wrote something else in between → the next message is not the answer.
    await db.insert(whatsappMessages).values({ phone: b.phone, userId: b.userId, direction: 'out', kind: 'reply', body: 'Hecho.', status: 'sent' })
    expect(await recordQuestionAnswer(b.userId, 'Otra cosa', db, new Date())).toBe(false)
    expect(await db.select().from(userFeedback).where(and(eq(userFeedback.userId, b.userId), eq(userFeedback.tag, 'pregunta_unica')))).toEqual([])

    const [summary] = (await store.list()).filter((q) => q.text === TEXT)
    expect(summary).toMatchObject({ sent: 2, failed: 0, answered: 1 })
  })
})
