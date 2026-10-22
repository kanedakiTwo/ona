/**
 * PRO-320 — the ficha's refiner at the moment (sign-up, «Afina tu menú») and
 * the weekly pass, with the model simulated (specs/household-profile.md →
 * «At the moment and every week»). The weekly batch against Postgres:
 * profileRefinerNow.smoke.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {}, pool: {} }))

import { computeCostMicros } from '../config/pricing.js'
import { setCostSinkForTests, type CostRow } from '../services/costLedger.js'
import type { HouseholdDaySignals } from '../services/profile/signals.js'
import {
  BATCH_PRICE_FACTOR,
  REFINER_FEATURE,
  REFINER_MODEL,
  WEEKLY_REFINER_DAYS,
  buildRefinerRequest,
  combineDaySignals,
  handleRefinerResult,
  refineHouseholdNow,
  refsOf,
  type RealtimeDeps,
  type RefinerContext,
  type RefinerPlan,
} from '../services/profile/refiner.js'
import { tasteRoundEnded } from '../services/tasteStore.js'
import { CLAUDE_MODEL } from '../config/models.js'

const HH = '11111111-1111-4111-8111-111111111111'
const U1 = '22222222-2222-4222-8222-222222222222'
const FACT_USER = '44444444-4444-4444-8444-444444444444'
const DAY = '2026-10-21'
const NOW = new Date('2026-10-21T19:30:00+02:00') // beta

function ctx(over: Partial<RefinerContext> = {}): RefinerContext {
  return {
    householdId: HH,
    day: DAY,
    members: [{ label: 'P1', userId: U1, role: 'owner' }],
    persons: [],
    facts: [{ id: FACT_USER, ref: 'F1', subjectUserId: null, subjectPersonId: null, type: 'equipment', value: ['horno'], origin: 'user', confidence: 1, evidence: [], validUntil: null }],
    portrait: null,
    pendingQuestions: [],
    ...over,
  }
}

const daySignals = (day: string, text: string, n = 1): HouseholdDaySignals => ({
  householdId: HH, day, members: ctx().members, omitted: 0, text,
  signals: Array.from({ length: n }, () => ({ at: new Date(`${day}T12:00:00Z`), source: 'chat' as const, who: 'P1', text: 'x' })),
})

const ALTA = 'Señales del hogar del 2026-10-21. 19:20 · P1 · Alta · Cocinan: 3-4 veces por semana. Platos favoritos: «lentejas», «pizza los viernes»'

function modelSays(answer: object, usage = { input_tokens: 9000, output_tokens: 2500 }) {
  return { content: [{ type: 'thinking' }, { type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', usage }
}

const PIZZA = {
  op: 'add', fact: '', subject: 'hogar', type: 'fixed_dish', valueJson: JSON.stringify({ dish: 'pizza', days: ['viernes'], meal: 'dinner' }),
  confidence: 0.8, evidence: [{ signal: 'alta', date: DAY, summary: 'En el alta dijo «pizza los viernes»' }], validUntil: '', reason: 'Lo dijo en el alta', question: '',
}

function deps(over: Partial<RealtimeDeps> & { written?: Array<{ plan: RefinerPlan; origin?: string }> } = {}) {
  const written = over.written ?? []
  const create = vi.fn(async () => modelSays({ facts: [PIZZA], portrait: '', questions: [] }))
  const finish = vi.fn(async () => {})
  const d: RealtimeDeps = {
    db: {} as any,
    create,
    candidate: async () => ({ householdId: HH, ownerId: U1, ownerSuspended: false, subscriptionStatus: null }),
    capExceeded: async () => false,
    collectSignals: async () => daySignals(DAY, ALTA),
    loadContext: async () => ctx(),
    claim: async () => 'row-1',
    finish,
    apply: async (_h, plan, opts) => { written.push({ plan, origin: opts?.origin }); return plan.ops.length },
    ...over,
  }
  return { d, create: d.create as typeof create, finish: d.finish as typeof finish, written }
}

afterEach(() => setCostSinkForTests(null))

describe('al momento: al acabar el alta y una tanda de «Afina tu menú» (PRO-320)', () => {
  it('alta → hechos al momento, con origen ai_realtime, el modelo del refinador y su coste en la ficha', async () => {
    const rows: CostRow[] = []
    setCostSinkForTests(async (r) => { rows.push(r) })
    const { d, create, finish, written } = deps()
    const out = await refineHouseholdNow(HH, 'onboarding', NOW, d)
    expect(out).toMatchObject({ status: 'applied', applied: 1, discarded: [] })

    // One request (not a batch) to the refiner's model, Opus 5.5 or better (D-070).
    expect(create).toHaveBeenCalledTimes(1)
    const params = create.mock.calls[0][0] as any
    expect(params.model).toBe(REFINER_MODEL)
    expect(REFINER_MODEL).toBe(CLAUDE_MODEL)
    expect(CLAUDE_MODEL).toBe('claude-opus-5-5')
    expect(params.messages[0].content).toMatch(/Pasada al momento: este hogar acaba de terminar el alta/)
    expect(params.messages[0].content).toContain('«pizza los viernes»')

    expect(written).toHaveLength(1)
    expect(written[0].origin).toBe('ai_realtime')
    expect(written[0].plan.ops[0]).toMatchObject({ kind: 'add', type: 'fixed_dish', value: { dish: 'pizza', days: ['viernes'], meal: 'dinner' } })
    expect(finish).toHaveBeenCalledWith('row-1', expect.objectContaining({ status: 'applied', applied: 1 }), refsOf(ctx()), NOW)

    // Cost: feature «ficha», the household and its owner (their monthly cap), full price (no batch).
    await new Promise((r) => setImmediate(r))
    expect(rows).toHaveLength(1)
    const list = computeCostMicros('anthropic', REFINER_MODEL, { inputTokens: 9000, outputTokens: 2500, cacheReadTokens: 0, cacheWriteTokens: 0 })!
    expect(rows[0]).toMatchObject({ feature: REFINER_FEATURE, model: REFINER_MODEL, userId: U1, householdId: HH })
    expect(rows[0].costMicros).toBe(list)
  })

  it('una tanda de «Afina» lo dice en la petición', () => {
    const req = buildRefinerRequest(ctx(), 'x', 'realtime', 'afina')
    expect((req.params.messages[0].content as string)).toMatch(/una tanda de «Afina tu menú»/)
  })

  it('las mismas reglas que de noche: salud fuera, lo del usuario manda, tope de 10', async () => {
    const answer = {
      facts: [
        { ...PIZZA, type: 'notes', valueJson: JSON.stringify(['Es celíaca']) },
        { ...PIZZA, op: 'update', fact: 'F1', type: 'equipment', valueJson: JSON.stringify(['microondas']), question: '¿Seguís teniendo horno?' },
        ...Array.from({ length: 12 }, (_, i) => ({ ...PIZZA, type: 'affinity', valueJson: JSON.stringify({ kind: 'ingredient', target: `cosa ${i}`, score: 1 }) })),
      ],
      portrait: '', questions: [],
    }
    const { d, written } = deps({ create: vi.fn(async () => modelSays(answer)) })
    const out = await refineHouseholdNow(HH, 'afina', NOW, d)
    expect(out.status).toBe('applied')
    const plan = written[0].plan
    expect(plan.ops).toHaveLength(10)
    expect(plan.ops[0]).toMatchObject({ kind: 'question', question: '¿Seguís teniendo horno?' })
    expect(plan.discarded.map((x) => x.reason)).toEqual(expect.arrayContaining(['health', 'over_limit']))
  })

  it('tope del hogar, plan en pausa, sin actividad o una pasada hace nada: no se llama al modelo', async () => {
    const cases: Array<[Partial<RealtimeDeps>, string]> = [
      [{ capExceeded: async () => true }, 'spend_cap'],
      [{ candidate: async () => ({ householdId: HH, ownerId: U1, ownerSuspended: false, subscriptionStatus: 'paused' }) }, 'paused'],
      [{ candidate: async () => ({ householdId: HH, ownerId: U1, ownerSuspended: true, subscriptionStatus: null }) }, 'suspended'],
      [{ collectSignals: async () => daySignals(DAY, 'Sin actividad.', 0) }, 'no_activity'],
      [{ claim: async () => null }, 'cooldown'],
      [{ candidate: async () => null }, 'no_household'],
    ]
    for (const [over, reason] of cases) {
      const { d, create, written } = deps(over)
      expect(await refineHouseholdNow(HH, 'onboarding', NOW, d)).toEqual({ status: 'skipped', reason })
      expect(create).not.toHaveBeenCalled()
      expect(written).toEqual([])
    }
    // After the beta, only with a plan in trial or active.
    const { d } = deps()
    expect(await refineHouseholdNow(HH, 'onboarding', new Date('2027-02-01T12:00:00+01:00'), d)).toEqual({ status: 'skipped', reason: 'not_subscribed' })
  })

  it('una respuesta rota no escribe nada y queda registrada como fallida', async () => {
    const { d, finish, written } = deps({ create: vi.fn(async () => ({ content: [{ type: 'text', text: '{"facts":"x"}' }], stop_reason: 'end_turn', usage: null })) })
    const out = await refineHouseholdNow(HH, 'onboarding', NOW, d)
    expect(out.status).toBe('failed')
    expect(written).toEqual([])
    expect(finish).toHaveBeenCalledWith('row-1', expect.objectContaining({ status: 'failed' }), expect.anything(), NOW)
    // A thrown error (network) too.
    const boom = deps({ create: vi.fn(async () => { throw new Error('529 overloaded') }) })
    expect(await refineHouseholdNow(HH, 'onboarding', NOW, boom.d)).toMatchObject({ status: 'failed', error: '529 overloaded' })
  })

  it('una tanda acaba cada 10 tarjetas', () => {
    expect(tasteRoundEnded(10, 10)).toBe(true)
    expect(tasteRoundEnded(20, 10)).toBe(true)
    expect(tasteRoundEnded(9, 10)).toBe(false)
    expect(tasteRoundEnded(0, 10)).toBe(false)
  })
})

describe('repaso semanal: patrones lentos de 4 semanas (PRO-320)', () => {
  it('junta los días con actividad en orden y, si no caben, quita los más antiguos', () => {
    const days = [
      daySignals('2026-09-25', 'Día 25: «ceviche»'),
      daySignals('2026-09-24', 'Sin actividad.', 0),
      daySignals('2026-10-09', 'Día 9: «ceviche»'),
      daySignals('2026-10-19', 'Día 19: «tortilla»'),
    ]
    const all = combineDaySignals(HH, '2026-10-19', days)
    expect(all.text).toBe('Día 25: «ceviche»\n\nDía 9: «ceviche»\n\nDía 19: «tortilla»')
    expect(all.signals).toHaveLength(3)
    expect(all.members).toEqual(ctx().members)
    const long = (day: string, what: string) => daySignals(day, `${what} ${'·'.repeat(100 - what.length - 1)}`)
    const big = [long('2026-09-25', 'Día 25'), long('2026-10-09', 'Día 9'), long('2026-10-19', 'Día 19')]
    const cut = combineDaySignals(HH, '2026-10-19', big, 260)
    expect(cut.text.startsWith('(No caben el día más antiguo con actividad)\n\nDía 9 ')).toBe(true)
    expect(cut.text).toContain('Día 19 ')
    expect(cut.text).not.toContain('Día 25')
    expect(cut.text.length).toBeLessThanOrEqual(260)
    expect(cut.omitted).toBe(1)
    expect(combineDaySignals(HH, '2026-10-19', [daySignals('2026-10-01', 'Sin actividad.', 0)]).signals).toEqual([])
  })

  it('semana → patrón lento («cada 15 días pide ceviche») con origen ai_weekly, al precio de los lotes', async () => {
    const req = buildRefinerRequest(ctx({ day: '2026-10-26' }), 'Día 9: «ceviche»', 'weekly')
    const text = req.params.messages[0].content as string
    expect(text).toMatch(new RegExp(`Repaso semanal: <senales> son las últimas ${WEEKLY_REFINER_DAYS / 7} semanas`))
    expect(text).toContain('dish_frequency')

    const rows: CostRow[] = []
    setCostSinkForTests(async (r) => { rows.push(r) })
    let written: { plan: RefinerPlan; origin?: string } | null = null
    const ceviche = {
      ...PIZZA, type: 'dish_frequency', valueJson: JSON.stringify({ dish: 'ceviche', minWeeks: 2, maxWeeks: 2 }),
      evidence: [{ signal: 'menu', date: '2026-09-25', summary: 'Pidió ceviche' }, { signal: 'menu', date: '2026-10-09', summary: 'Pidió ceviche otra vez' }],
      reason: 'Cada 15 días pide ceviche',
    }
    const out = await handleRefinerResult(
      { householdId: HH, billedUserId: U1, refs: refsOf(ctx()) }, '2026-10-26',
      { type: 'succeeded', message: modelSays({ facts: [ceviche], portrait: '', questions: [] }, { input_tokens: 20000, output_tokens: 3000 }) },
      { kind: 'weekly', loadContext: async () => ctx(), apply: async (_h, plan, opts) => { written = { plan, origin: opts?.origin }; return plan.ops.length } },
    )
    expect(out).toMatchObject({ status: 'applied', applied: 1 })
    expect(written!.origin).toBe('ai_weekly')
    expect(written!.plan.ops[0]).toMatchObject({ kind: 'add', type: 'dish_frequency', value: { dish: 'ceviche', minWeeks: 2, maxWeeks: 2 } })
    await new Promise((r) => setImmediate(r))
    const list = computeCostMicros('anthropic', REFINER_MODEL, { inputTokens: 20000, outputTokens: 3000, cacheReadTokens: 0, cacheWriteTokens: 0 })!
    expect(rows[0]).toMatchObject({ feature: REFINER_FEATURE, userId: U1, householdId: HH })
    expect(rows[0].costMicros).toBe(Math.round(list * BATCH_PRICE_FACTOR))
  })

  it('el repaso semanal tampoco deduce salud ni pisa lo del usuario', async () => {
    let written: RefinerPlan | null = null
    await handleRefinerResult(
      { householdId: HH, billedUserId: U1, refs: refsOf(ctx()) }, '2026-10-26',
      { type: 'succeeded', message: modelSays({ facts: [
        { ...PIZZA, subject: 'P1', type: 'restrictions', valueJson: JSON.stringify(['sin gluten']) },
        { ...PIZZA, op: 'retire', fact: 'F1', type: 'equipment', valueJson: '' },
      ], portrait: '', questions: [] }) },
      { kind: 'weekly', loadContext: async () => ctx(), apply: async (_h, plan) => { written = plan; return plan.ops.length } },
    )
    expect(written!.ops.map((o) => o.kind)).toEqual(['question'])
    expect(written!.discarded).toEqual([{ reason: 'health', op: 'add', type: 'restrictions' }])
  })
})
