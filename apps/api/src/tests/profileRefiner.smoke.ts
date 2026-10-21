/**
 * Smoke (real API + Postgres) for PRO-152 (specs/household-profile.md →
 * «Nightly refiner»): one night end to end against the database, with the
 * Message Batches API simulated — the run is claimed once, the batch carries
 * the household's day, and collecting it writes the ficha and its history
 * with the code rules (health discarded and recorded, the user's fact becomes
 * a question).
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/profileRefiner.smoke.ts
 *
 * Registers its own user (needs REGISTRATION_MODE=open, as CI's smoke job).
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { chatMessages, profileChanges, profileFacts, profileQuestions, profileRefinements, profileRefinerRuns, users } from '../db/schema.js'
import {
  collectRefinerResults,
  defaultRefinerDeps,
  submitNightlyRefinement,
  type BatchResultLike,
  type RefinerBatchClient,
} from '../services/profile/refiner.js'

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

describe.skipIf(!reachable)('refinador nocturno de la ficha (PRO-152)', () => {
  it('sends the day once and writes the ficha with the rules applied', async () => {
    const now = new Date()
    const day = madridDay(now)
    const u = `refinador_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
    const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'smokepass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    const userId = reg.body.user.id as string
    const token = reg.body.token as string
    const onb = await call('POST', `/user/${userId}/onboarding`, {
      adults: 2, kidsCount: 1, cookingFreq: '3_4_times', favoriteDishes: ['lentejas'], priority: 'quick', restrictions: [], weekdayCooking: 'rapido',
    }, token)
    expect(onb.status).toBe(200)
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    const householdId = user.primaryHouseholdId!
    expect(householdId).toBeTruthy()

    // What the user said (wins) and what happened today.
    const [userFact] = await db.insert(profileFacts).values({ householdId, type: 'equipment', value: ['horno', 'microondas'], origin: 'user', confidence: 1 }).returning()
    await db.insert(chatMessages).values({ userId, householdId, role: 'user', body: 'Esta semana estamos sin horno, se nos ha roto' })

    // Only this household, whatever else the smoke DB holds; a fresh day row.
    await db.delete(profileRefinerRuns).where(and(eq(profileRefinerRuns.day, day), eq(profileRefinerRuns.kind, 'nightly')))
    const sent: Array<{ custom_id: string; params: any }> = []
    const fakeBatch: RefinerBatchClient = {
      async create(requests) { sent.push(...requests); return { id: 'msgbatch_smoke' } },
      async status() { return 'ended' },
      async results() {
        // The user's equipment fact by its reference in the prompt (the sign-up's own facts come first since PRO-316).
        const equipmentRef = /(F\d+) · hogar · equipment/.exec(sent[0].params.messages[0].content)?.[1] ?? 'F1'
        const answer = JSON.stringify({
          facts: [
            { op: 'add', fact: '', subject: 'hogar', type: 'temporary_situation', valueJson: JSON.stringify({ description: 'Sin horno' }), confidence: 0.9,
              evidence: [{ signal: 'chat', date: day, summary: 'Dijo en el chat que están sin horno' }], validUntil: '', reason: 'Lo dijo en el chat', question: '' },
            { op: 'add', fact: '', subject: 'P1', type: 'notes', valueJson: JSON.stringify(['Es diabético']), confidence: 0.6,
              evidence: [{ signal: 'chat', date: day, summary: 'Deducido' }], validUntil: '', reason: 'Deducido', question: '' },
            { op: 'update', fact: equipmentRef, subject: 'hogar', type: 'equipment', valueJson: JSON.stringify(['microondas']), confidence: 0.8,
              evidence: [{ signal: 'chat', date: day, summary: 'Sin horno' }], validUntil: '', reason: 'Sin horno', question: '¿Seguís sin horno?' },
          ],
          portrait: 'Cocináis rápido entre semana y ahora os apañáis sin horno.',
          questions: [],
        })
        const results: BatchResultLike[] = sent.map((r) => ({
          custom_id: r.custom_id,
          result: { type: 'succeeded', message: { content: [{ type: 'text', text: answer }], stop_reason: 'end_turn', usage: { input_tokens: 8000, output_tokens: 3000 } } },
        }))
        return (async function* () { yield* results })()
      },
    }
    const deps = {
      ...defaultRefinerDeps(db),
      batch: fakeBatch,
      listCandidates: async () => (await defaultRefinerDeps(db).listCandidates()).filter((c) => c.householdId === householdId),
      capExceeded: async () => false,
    }

    const submit = await submitNightlyRefinement(day, now, deps)
    expect(submit).toMatchObject({ status: 'submitted', requested: 1, batchId: 'msgbatch_smoke' })
    expect(sent).toHaveLength(1)
    expect(sent[0].custom_id).toBe(householdId)
    expect(sent[0].params.messages[0].content).toContain('«Esta semana estamos sin horno, se nos ha roto»')
    // (The sign-up's «tiempo para cocinar» is in the ficha too since PRO-316, so the user's fact may not be F1.)
    expect(sent[0].params.messages[0].content).toMatch(/F\d+ · hogar · equipment · \["horno","microondas"\] · lo dijo el usuario/)
    // A second tick never sends the day again.
    expect((await submitNightlyRefinement(day, now, deps)).status).toBe('already')

    expect(await collectRefinerResults(now, deps)).toBeGreaterThanOrEqual(1)

    const facts = await db.select().from(profileFacts).where(eq(profileFacts.householdId, householdId))
    const sinHorno = facts.find((f) => f.type === 'temporary_situation')!
    expect(sinHorno).toMatchObject({ origin: 'ai_nightly', status: 'active', value: { description: 'Sin horno' } })
    expect(sinHorno.evidence).toEqual([{ signal: 'chat', date: day, summary: 'Dijo en el chat que están sin horno' }])
    expect(JSON.stringify(facts)).not.toMatch(/diab/i)
    // The user's fact is untouched; the contradiction is a pending question.
    expect(facts.find((f) => f.id === userFact.id)).toMatchObject({ value: ['horno', 'microondas'], origin: 'user', status: 'active' })
    const questions = await db.select().from(profileQuestions).where(eq(profileQuestions.householdId, householdId))
    expect(questions.map((q) => [q.question, q.status, q.origin])).toEqual([['¿Seguís sin horno?', 'pending', 'ai_nightly']])

    // What the refiner wrote (the sign-up's own facts have their rows too since PRO-316).
    const changes = await db.select().from(profileChanges).where(and(eq(profileChanges.householdId, householdId), eq(profileChanges.origin, 'ai_nightly')))
    expect(changes.map((c) => c.action).sort()).toEqual(['fact_added', 'portrait_updated', 'question_added'])

    const [ref] = await db.select().from(profileRefinements).where(eq(profileRefinements.householdId, householdId))
    expect(ref).toMatchObject({ status: 'applied', applied: 3, billedUserId: userId, discarded: [{ reason: 'health', op: 'add', type: 'notes' }] })
    const [run] = await db.select().from(profileRefinerRuns).where(eq(profileRefinerRuns.day, day))
    expect(run.status).toBe('ended')
  })
})
