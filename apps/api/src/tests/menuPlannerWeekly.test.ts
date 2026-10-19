/**
 * PRO-258 — la semana se piensa el sábado por la noche (specs/smart-menu.md).
 * The scheduler: when it is due, which households go, once per week, the
 * batch at half price, and collecting it leaves every household with next
 * week thought. Batch, store and households simulated.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {}, pool: {} }))

import type { DayMenu } from '@ona/shared'
import { computeCostMicros } from '../config/pricing.js'
import { setCostSinkForTests, type CostRow } from '../services/costLedger.js'
import { buildPlannerCandidates, slotsToPlan, PLANNER_MODEL, type PlannerRecipe } from '../services/menuPlanner.js'
import {
  collectWeeklyPlans,
  fromStoredContext,
  runWeeklyPlannerIfDue,
  submitWeeklyPlans,
  toStoredContext,
  weeklyPlanDue,
  type StoredContext,
  type WeeklyDeps,
  type WeeklyStore,
} from '../services/menuPlannerWeekly.js'
import type { BatchResultLike, RefinerCandidate } from '../services/profile/refiner.js'

const rec = (id: string, name: string, ings: string[], kcal: number): PlannerRecipe => ({
  id, name, meals: ['lunch', 'dinner'], seasons: [], tags: [], equipment: [], course: 'main',
  ingredients: ings.map((n, i) => ({ ingredientId: `${id}-${i}`, ingredientName: n, quantity: 100, unit: 'g' })),
  nutritionPerServing: { kcal },
})
const RECIPES = [rec('lentejas', 'Lentejas', ['lentejas'], 450), rec('merluza', 'Merluza', ['merluza'], 380), rec('crema', 'Crema', ['calabacín'], 300), rec('tortilla', 'Tortilla', ['huevo'], 350)]
const GEN: DayMenu[] = [
  { lunch: { dishes: [{ kind: 'recipe', recipeId: 'lentejas', recipeName: 'Lentejas' }] }, dinner: { dishes: [{ kind: 'recipe', recipeId: 'crema', recipeName: 'Crema' }] } },
]

// Saturday 2026-10-24 22:00 Madrid (CEST) → next week starts Monday 2026-10-26.
const SAT_NIGHT = new Date('2026-10-24T20:00:00Z')

describe('weeklyPlanDue', () => {
  it('is due on Saturday from 21:00 Madrid (and as a catch-up early on Sunday), for the Monday after', () => {
    expect(weeklyPlanDue(SAT_NIGHT)).toEqual({ due: true, weekStart: '2026-10-26' })
    expect(weeklyPlanDue(new Date('2026-10-24T18:30:00Z')).due).toBe(false) // 20:30
    expect(weeklyPlanDue(new Date('2026-10-25T05:00:00Z'))).toEqual({ due: true, weekStart: '2026-10-26' }) // Sunday 06:00 (CET)
    expect(weeklyPlanDue(new Date('2026-10-25T11:00:00Z')).due).toBe(false) // Sunday noon
    expect(weeklyPlanDue(new Date('2026-10-21T20:00:00Z')).due).toBe(false) // Wednesday night
  })
})

function memoryStore() {
  const runs: Array<{ id: string; weekStart: string; status: string; batchId: string | null; requested: number; skipped: object }> = []
  const items: Array<{ id: string; runId: string; householdId: string; userId: string; context: StoredContext; status: string; values?: Record<string, unknown> }> = []
  const store: WeeklyStore = {
    async runExists(w) { return runs.some((r) => r.weekStart === w) },
    async claimRun(w, v) {
      if (runs.some((r) => r.weekStart === w)) return null
      const id = `run${runs.length + 1}`
      runs.push({ id, weekStart: w, status: v.status, batchId: null, requested: v.requested, skipped: v.skipped })
      return id
    },
    async setBatch(id, b) { runs.find((r) => r.id === id)!.batchId = b },
    async failRun(id) { runs.find((r) => r.id === id)!.status = 'failed' },
    async insertItems(runId, list) { for (const i of list) items.push({ id: `item${items.length + 1}`, runId, status: 'pending', ...i }) },
    async submittedRuns() { return runs.filter((r) => r.status === 'submitted') },
    async pendingItems(runId) { return items.filter((i) => i.runId === runId && i.status === 'pending') },
    async completeItem(id, values) { const i = items.find((x) => x.id === id)!; i.status = String(values.status); i.values = values },
    async endRun(id) { runs.find((r) => r.id === id)!.status = 'ended' },
  }
  return { store, runs, items }
}

const cand = (n: number, over: Partial<RefinerCandidate> = {}): RefinerCandidate => ({ householdId: `h${n}`, ownerId: `u${n}`, ownerSuspended: false, subscriptionStatus: 'active', ...over })

function deps(over: Partial<WeeklyDeps> = {}) {
  const mem = memoryStore()
  const sent: any[] = []
  const answers = new Map<string, BatchResultLike['result']>()
  const d: WeeklyDeps = {
    store: mem.store,
    batch: {
      async create(reqs) { sent.push(...reqs); return { id: 'batch1' } },
      async status() { return 'ended' },
      async results() { return (async function* () { for (const r of sent) if (answers.has(r.custom_id)) yield { custom_id: r.custom_id, result: answers.get(r.custom_id)! } })() },
    },
    listCandidates: async () => [cand(1), cand(2, { subscriptionStatus: 'paused' }), cand(3), cand(4), cand(5)],
    capExceeded: async (u) => u === 'u4',
    isActive: async (c) => c.householdId !== 'h5',
    prepare: async () => {
      const candidates = buildPlannerCandidates(RECIPES, { season: 'autumn', restrictions: [], dislikes: [] })
      return {
        ok: true,
        generatorDays: GEN,
        banned: new Set<string>(),
        ctx: { householdId: null, recipes: RECIPES, candidates, slots: slotsToPlan(GEN), restrictions: [], dislikes: [], fixedRecipeIds: new Set(), lightDinners: false, season: 'autumn', prompt: 'PROMPT' },
      }
    },
    rebuild: async (item) => fromStoredContext(item.context, RECIPES, item.householdId),
    ...over,
  }
  return { d, mem, sent, answers }
}

afterEach(() => setCostSinkForTests(null))

describe('submitWeeklyPlans + collectWeeklyPlans', () => {
  it('sends one batch on Saturday night with the households that qualify, once, and on Sunday each has next week thought', async () => {
    const costs: CostRow[] = []
    setCostSinkForTests(async (r) => { costs.push(r) })
    const { d, mem, sent, answers } = deps()
    const first = await submitWeeklyPlans('2026-10-26', SAT_NIGHT, d)
    expect(first).toMatchObject({ status: 'submitted', requested: 2, skipped: { paused: 1, spend_cap: 1, inactive: 1 }, batchId: 'batch1' })
    expect(sent.map((r) => r.custom_id)).toEqual(['h1', 'h3'])
    expect(sent[0].params.model).toBe(PLANNER_MODEL)
    expect(sent[0].params.messages[0].content).toBe('PROMPT')
    // A second tick never sends it again.
    expect((await submitWeeklyPlans('2026-10-26', SAT_NIGHT, d)).status).toBe('already')
    expect(sent).toHaveLength(2)

    const ref = (id: string) => mem.items[0].context.candidates.find((c) => c.recipeId === id)!.ref
    const ok = (slots: object[]): BatchResultLike['result'] => ({ type: 'succeeded', message: { stop_reason: 'end_turn', usage: { input_tokens: 10_000, output_tokens: 4_000 }, content: [{ type: 'text', text: JSON.stringify({ slots }) }] } })
    answers.set('h1', ok([
      { day: 0, meal: 'lunch', ref: ref('merluza'), why: 'pescado para empezar', leftoverOfDay: -1, leftoverOfMeal: '' },
      { day: 0, meal: 'dinner', ref: ref('tortilla'), why: 'cena rápida', leftoverOfDay: -1, leftoverOfMeal: '' },
    ]))
    answers.set('h3', { type: 'errored' })

    expect(await collectWeeklyPlans(new Date('2026-10-24T21:00:00Z'), d)).toBe(2)
    expect(mem.runs[0].status).toBe('ended')
    const h1 = mem.items.find((i) => i.householdId === 'h1')!
    expect(h1.status).toBe('ok')
    expect((h1.values!.days as DayMenu[])[0].lunch!.dishes[0]).toMatchObject({ recipeId: 'merluza', why: 'pescado para empezar' })
    expect(h1.values!.plannerScore).toBeTruthy()
    expect(mem.items.find((i) => i.householdId === 'h3')!.status).toBe('failed')
    // Half price: the batch discount on the owner's ledger.
    expect(costs).toHaveLength(1)
    expect(costs[0]).toMatchObject({ feature: 'menu_planner', userId: 'u1', householdId: 'h1' })
    expect(h1.values!.costMicros).toBe(costs[0].costMicros)
    expect(costs[0].costMicros).toBe(Math.round(computeCostMicros('anthropic', PLANNER_MODEL, { inputTokens: 10_000, outputTokens: 4_000, cacheWriteTokens: 0, cacheReadTokens: 0 })! / 2))
  })

  it('an empty Saturday is recorded once; a failing batch marks the run failed', async () => {
    const empty = deps({ listCandidates: async () => [cand(2, { subscriptionStatus: 'paused' })] })
    expect((await submitWeeklyPlans('2026-10-26', SAT_NIGHT, empty.d)).status).toBe('empty')
    expect(empty.mem.runs[0].status).toBe('empty')
    const failing = deps()
    failing.d.batch.create = async () => { throw new Error('overloaded') }
    expect(await submitWeeklyPlans('2026-10-26', SAT_NIGHT, failing.d)).toMatchObject({ status: 'failed', error: 'overloaded' })
  })

  it('a household whose week can\'t be prepared is left out, the rest go', async () => {
    const { d } = deps({ prepare: async (c) => (c.householdId === 'h1' ? { ok: false, reason: 'no_candidates' } : deps().d.prepare(c, '2026-10-26')) })
    expect(await submitWeeklyPlans('2026-10-26', SAT_NIGHT, d)).toMatchObject({ requested: 1, skipped: { no_candidates: 1 } })
  })

  it('runWeeklyPlannerIfDue only submits when due, and always collects', async () => {
    const { d, sent } = deps()
    expect((await runWeeklyPlannerIfDue(new Date('2026-10-21T20:00:00Z'), d))?.submit).toBeNull()
    expect(sent).toHaveLength(0)
    expect((await runWeeklyPlannerIfDue(SAT_NIGHT, d))?.submit?.status).toBe('submitted')
  })

  it('stores recipe ids, not recipes, and rebuilds with today\'s catalogue', () => {
    const candidates = buildPlannerCandidates(RECIPES, { season: 'autumn', restrictions: [], dislikes: [] })
    const stored = toStoredContext({ householdId: 'h1', recipes: RECIPES, candidates, slots: slotsToPlan(GEN), restrictions: ['sin gluten'], dislikes: [], fixedRecipeIds: new Set(), lightDinners: true, season: 'autumn', unavailableEquipment: new Set(['horno']) }, GEN, new Set(['x']))
    expect(JSON.parse(JSON.stringify(stored)).candidates[0]).toEqual({ ref: 'C1', recipeId: candidates[0].recipe.id, meals: ['lunch', 'dinner'] })
    const back = fromStoredContext(stored, RECIPES.slice(1), 'h1')
    expect(back.candidates.length).toBe(candidates.length - (candidates.some((c) => c.recipe.id === 'lentejas') ? 1 : 0))
    expect([...back.unavailableEquipment!]).toEqual(['horno'])
    expect(back.lightDinners).toBe(true)
  })
})
