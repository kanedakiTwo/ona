/**
 * Smoke (Postgres) for PRO-320 (specs/household-profile.md → «At the moment
 * and every week»): the pass at the moment after the sign-up writes facts
 * with origin `ai_realtime` and is not repeated within the cooldown; the
 * weekly batch carries the last weeks' signals and its result writes
 * `ai_weekly` facts. The model is simulated.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/profileRefinerNow.smoke.ts
 *
 * Registers its own user (needs REGISTRATION_MODE=open, as CI's smoke job).
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { chatMessages, profileChanges, profileFacts, profileRefinements, profileRefinerRuns, users } from '../db/schema.js'
import {
  defaultRealtimeDeps,
  defaultRefinerDeps,
  handleRefinerResult,
  refineHouseholdNow,
  submitWeeklyRefinement,
  type RefinerBatchClient,
  type RefinerRefs,
} from '../services/profile/refiner.js'
import { addDays } from '../services/madridTime.js'

async function call(method: string, path: string, payload?: unknown, token?: string) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

const madridDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)
const answer = (facts: unknown[]) => ({ content: [{ type: 'text', text: JSON.stringify({ facts, portrait: '', questions: [] }) }], stop_reason: 'end_turn', usage: { input_tokens: 5000, output_tokens: 800 } })

describe.skipIf(!reachable)('la ficha al momento y cada semana (PRO-320)', () => {
  it('sign-up → facts at once (ai_realtime, once per cooldown); four weeks → a slow pattern (ai_weekly)', async () => {
    const now = new Date()
    const day = madridDay(now)
    const u = `alMomento_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
    const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'smokepass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    const userId = reg.body.user.id as string
    const onb = await call('POST', `/user/${userId}/onboarding`, {
      adults: 2, kidsCount: 0, cookingFreq: '3_4_times', favoriteDishes: ['pizza'], priority: 'quick', restrictions: [], weekdayCooking: 'rapido',
      cookingNote: 'Los viernes cenamos pizza casera',
    }, reg.body.token)
    expect(onb.status).toBe(200)
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    const householdId = user.primaryHouseholdId!

    // ── At the moment, after the sign-up ──
    const sent: any[] = []
    const realtime = {
      ...defaultRealtimeDeps(db),
      capExceeded: async () => false,
      create: async (params: any) => {
        sent.push(params)
        return answer([{
          op: 'add', fact: '', subject: 'hogar', type: 'fixed_dish', valueJson: JSON.stringify({ dish: 'pizza casera', days: ['viernes'], meal: 'dinner' }),
          confidence: 0.85, evidence: [{ signal: 'alta', date: day, summary: 'En el alta dijo que los viernes cenan pizza casera' }], validUntil: '', reason: 'Del alta', question: '',
        }])
      },
    }
    const out = await refineHouseholdNow(householdId, 'onboarding', now, realtime)
    expect(out).toMatchObject({ status: 'applied', applied: 1 })
    expect(sent).toHaveLength(1)
    expect(sent[0].messages[0].content).toMatch(/Pasada al momento/)
    expect(sent[0].messages[0].content).toContain('Los viernes cenamos pizza casera')
    const [pizza] = await db.select().from(profileFacts).where(and(eq(profileFacts.householdId, householdId), eq(profileFacts.type, 'fixed_dish')))
    expect(pizza).toMatchObject({ origin: 'ai_realtime', status: 'active', value: { dish: 'pizza casera', days: ['viernes'], meal: 'dinner' } })
    const [added] = await db.select().from(profileChanges).where(and(eq(profileChanges.factId, pizza.id), eq(profileChanges.action, 'fact_added')))
    expect(added.origin).toBe('ai_realtime')
    const [rt] = await db.select().from(profileRefinerRuns).where(and(eq(profileRefinerRuns.day, day), eq(profileRefinerRuns.kind, 'realtime')))
    const [rtRow] = await db.select().from(profileRefinements).where(and(eq(profileRefinements.runId, rt.id), eq(profileRefinements.householdId, householdId)))
    expect(rtRow).toMatchObject({ status: 'applied', applied: 1, billedUserId: userId })
    // A second round right after: no second call within the cooldown.
    expect(await refineHouseholdNow(householdId, 'afina', new Date(now.getTime() + 60_000), realtime)).toEqual({ status: 'skipped', reason: 'cooldown' })
    expect(sent).toHaveLength(1)

    // ── Every week: the last four weeks ──
    for (const back of [15, 1]) {
      await db.insert(chatMessages).values({ userId, householdId, role: 'user', body: 'Hoy toca ceviche', createdAt: new Date(now.getTime() - back * 24 * 3600 * 1000) })
    }
    const weekDay = addDays(day, 1)
    await db.delete(profileRefinerRuns).where(and(eq(profileRefinerRuns.day, weekDay), eq(profileRefinerRuns.kind, 'weekly')))
    const batchSent: any[] = []
    const fakeBatch: RefinerBatchClient = {
      async create(requests) { batchSent.push(...requests); return { id: 'msgbatch_weekly_smoke' } },
      async status() { return 'in_progress' },
      async results() { return (async function* () {})() },
    }
    const weekly = {
      ...defaultRefinerDeps(db),
      batch: fakeBatch,
      listCandidates: async () => (await defaultRefinerDeps(db).listCandidates()).filter((c) => c.householdId === householdId),
      capExceeded: async () => false,
    }
    const submit = await submitWeeklyRefinement(weekDay, now, weekly)
    expect(submit).toMatchObject({ status: 'submitted', requested: 1 })
    const text = batchSent[0].params.messages[0].content as string
    expect(text).toMatch(/Repaso semanal/)
    expect(text.match(/Hoy toca ceviche/g)?.length).toBe(2)
    expect((await submitWeeklyRefinement(weekDay, now, weekly)).status).toBe('already')
    const [wk] = await db.select().from(profileRefinerRuns).where(and(eq(profileRefinerRuns.day, weekDay), eq(profileRefinerRuns.kind, 'weekly')))
    const [wkRow] = await db.select().from(profileRefinements).where(and(eq(profileRefinements.runId, wk.id), eq(profileRefinements.householdId, householdId)))
    // Its result, as the collecting tick handles it (kind of the run → origin).
    const res = await handleRefinerResult({ householdId, billedUserId: wkRow.billedUserId, refs: wkRow.refs as RefinerRefs }, weekDay, {
      type: 'succeeded',
      message: answer([{
        op: 'add', fact: '', subject: 'hogar', type: 'dish_frequency', valueJson: JSON.stringify({ dish: 'ceviche', minWeeks: 2, maxWeeks: 2 }),
        confidence: 0.7, evidence: [{ signal: 'chat', date: addDays(day, -15), summary: 'Pidió ceviche' }, { signal: 'chat', date: addDays(day, -1), summary: 'Otra vez ceviche' }],
        validUntil: '', reason: 'Cada 15 días pide ceviche', question: '',
      }]),
    }, { db, now, kind: 'weekly' })
    expect(res).toMatchObject({ status: 'applied', applied: 1 })
    const [ceviche] = await db.select().from(profileFacts).where(and(eq(profileFacts.householdId, householdId), eq(profileFacts.type, 'dish_frequency')))
    expect(ceviche).toMatchObject({ origin: 'ai_weekly', value: { dish: 'ceviche', minWeeks: 2, maxWeeks: 2 } })
    // Leave nothing for another smoke's collecting tick.
    await db.update(profileRefinements).set({ status: 'applied', completedAt: now }).where(eq(profileRefinements.id, wkRow.id))
    await db.update(profileRefinerRuns).set({ status: 'ended', endedAt: now }).where(eq(profileRefinerRuns.id, wk.id))
  })
})
