/**
 * PRO-255 — Mimo piensa la semana, a la sombra (specs/smart-menu.md). Model
 * simulated; the checker with an allergy that slips through and a repeated
 * dish, candidates, the merge with the generator and the shadow run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {}, pool: {} }))

import type { DayMenu } from '@ona/shared'
import { setCostSinkForTests, type CostRow } from '../services/costLedger.js'
import {
  PLANNER_FEATURE,
  PLANNER_MODEL,
  buildPlannerCandidates,
  buildPlannerPrompt,
  checkPlan,
  mergeWithGenerator,
  parsePlannerMessage,
  slotsToPlan,
  type CheckContext,
  type PlannerOutput,
  type PlannerRecipe,
} from '../services/menuPlanner.js'
import { buildPlannerRequest, planMenuInShadow, type ShadowContext, type ShadowDeps } from '../services/menuPlannerShadow.js'

const rec = (id: string, name: string, ings: string[], over: Partial<PlannerRecipe> = {}): PlannerRecipe => ({
  id, name, meals: ['lunch', 'dinner'], seasons: [], tags: [], equipment: [], course: 'main',
  ingredients: ings.map((n, i) => ({ ingredientId: `${id}-i${i}`, ingredientName: n, quantity: 100, unit: 'g' })),
  ...over,
})

const LENTEJAS = rec('lentejas', 'Lentejas estofadas', ['lentejas', 'zanahoria'], { totalTime: 50, nutritionPerServing: { kcal: 450 } })
const MERLUZA = rec('merluza', 'Merluza en salsa verde', ['merluza', 'almejas'], { totalTime: 25, nutritionPerServing: { kcal: 380 } })
const CREMA = rec('crema', 'Crema de calabacín', ['calabacín', 'puerro'], { totalTime: 30, nutritionPerServing: { kcal: 220 } })
const PASTA = rec('pasta', 'Macarrones con tomate', ['macarrones', 'tomate'], { totalTime: 20, allergens: ['gluten'], nutritionPerServing: { kcal: 600 } })
const HORNO = rec('horno', 'Pollo al horno', ['pollo', 'patata'], { totalTime: 70, equipment: ['horno'], nutritionPerServing: { kcal: 550 } })
const TORTILLA = rec('tortilla', 'Tortilla de espinacas', ['huevo', 'espinacas'], { totalTime: 15, nutritionPerServing: { kcal: 300 } })
const ALL = [LENTEJAS, MERLUZA, CREMA, PASTA, HORNO, TORTILLA]

const gen = (pairs: Array<[string, string]>): DayMenu[] =>
  pairs.map(([l, d]) => ({
    lunch: { dishes: [{ kind: 'recipe', recipeId: l, recipeName: l, course: 'main' }] },
    dinner: { dishes: [{ kind: 'recipe', recipeId: d, recipeName: d, course: 'main' }] },
  }))

describe('buildPlannerCandidates', () => {
  it('applies today\'s fixed filters, drops what was rejected twice, and ranks loved, at-home and not-eaten-lately first', () => {
    const c = buildPlannerCandidates(ALL, {
      season: 'autumn', restrictions: ['sin gluten'], dislikes: [], unavailableEquipment: new Set(['horno']),
    }, {
      lovedRecipeIds: new Set(['crema']),
      rejectedCounts: new Map([['tortilla', 2]]),
      daysSinceEaten: new Map([['lentejas', 7]]),
      pantryIngredientIds: new Set(['merluza-i0']),
    })
    expect(c.map((x) => x.recipe.id)).toEqual(['crema', 'merluza', 'lentejas'])
    expect(c.map((x) => x.ref)).toEqual(['C1', 'C2', 'C3'])
    const prompt = buildPlannerPrompt({ weekStart: '2026-10-26', season: 'autumn', slots: [{ dayIndex: 0, meal: 'lunch' }], candidates: c, fichaDigest: 'Ficha del hogar…\n- el hogar: Situación temporal: Sin horno', memoryDigest: '', previousWeeks: [], edits: [], lightDinners: true })
    expect(prompt).toContain('C1 · Crema de calabacín')
    expect(prompt).toContain('os encanta')
    expect(prompt).toContain('en el menú hace 7 días')
    expect(prompt).toContain('en casa: merluza')
    expect(prompt).toContain('Sin horno')
    expect(prompt).toContain('cenas ligeras')
  })
})

describe('checkPlan (the fixed checker)', () => {
  const slots = slotsToPlan(gen([['lentejas', 'crema'], ['merluza', 'tortilla']]))
  // The candidate list is built WITHOUT the restriction on purpose: the
  // checker must catch an allergy even if a candidate slips through.
  const candidates = buildPlannerCandidates(ALL, { season: 'autumn', restrictions: [], dislikes: [] })
  const ref = (id: string) => candidates.find((c) => c.recipe.id === id)!.ref
  const ctx: CheckContext = {
    slots, candidates, recipesById: new Map(ALL.map((r) => [r.id, r])), restrictions: ['sin gluten'], dislikes: [],
  }
  const out = (s: Array<[number, 'lunch' | 'dinner', string, number?, string?]>): PlannerOutput => ({
    slots: s.map(([day, meal, r, lod, lom]) => ({ day, meal, ref: r, why: `por ${r}`, leftoverOfDay: lod ?? -1, leftoverOfMeal: lom ?? '' })),
  })

  it('passes a good week', () => {
    const c = checkPlan(out([[0, 'lunch', ref('lentejas')], [0, 'dinner', ref('crema')], [1, 'lunch', ref('merluza')], [1, 'dinner', ref('tortilla')]]), ctx)
    expect(c.ok).toBe(true)
    expect(c.slots.map((s) => s.why)).toContain('por ' + ref('lentejas'))
  })

  it('an allergy that slips through (gluten for a «sin gluten» household) is caught', () => {
    const c = checkPlan(out([[0, 'lunch', ref('lentejas')], [0, 'dinner', ref('pasta')], [1, 'lunch', ref('merluza')], [1, 'dinner', ref('tortilla')]]), ctx)
    expect(c.ok).toBe(false)
    expect(c.slots.find((s) => s.dayIndex === 0 && s.meal === 'dinner')!.problems).toEqual(['restriccion'])
    expect(c.problems).toEqual({ restriccion: 1 })
  })

  it('a repeated dish is caught, leftovers planned from an earlier slot are not', () => {
    const repeated = checkPlan(out([[0, 'lunch', ref('lentejas')], [0, 'dinner', ref('crema')], [1, 'lunch', ref('lentejas')], [1, 'dinner', ref('tortilla')]]), ctx)
    expect(repeated.slots.find((s) => s.dayIndex === 1 && s.meal === 'lunch')!.problems).toEqual(['repetido'])
    const leftovers = checkPlan(out([[0, 'lunch', ref('lentejas')], [0, 'dinner', ref('crema')], [1, 'lunch', ref('lentejas'), 0, 'lunch'], [1, 'dinner', ref('tortilla')]]), ctx)
    expect(leftovers.ok).toBe(true)
    const wrongLeftovers = checkPlan(out([[0, 'lunch', ref('lentejas')], [0, 'dinner', ref('crema')], [1, 'lunch', ref('merluza'), 0, 'lunch'], [1, 'dinner', ref('tortilla')]]), ctx)
    expect(wrongLeftovers.slots.find((s) => s.dayIndex === 1 && s.meal === 'lunch')!.problems).toEqual(['sobras_no_cuadran'])
  })

  it('a dish already fixed in the week (a locked slot) counts as a repeat', () => {
    const c = checkPlan(out([[0, 'lunch', ref('lentejas')], [0, 'dinner', ref('crema')], [1, 'lunch', ref('merluza')], [1, 'dinner', ref('tortilla')]]), { ...ctx, fixedRecipeIds: new Set(['merluza']) })
    expect(c.problems).toEqual({ repetido: 1 })
  })

  it('unknown references, missing and extra slots, vetoes, equipment, time and a weak day are caught', () => {
    const tight = { ...ctx, slots: ctx.slots.map((s) => (s.dayIndex === 1 && s.meal === 'lunch' ? { ...s, timeBudget: { mode: 'total' as const, minutes: 20 } } : s)), bannedRecipeIds: new Set(['crema']), unavailableEquipment: new Set(['horno']) }
    const c = checkPlan(out([[0, 'lunch', 'C999'], [0, 'dinner', ref('crema')], [1, 'lunch', ref('merluza')], [1, 'dinner', ref('horno')], [3, 'lunch', ref('tortilla')], [1, 'dinner', ref('tortilla')]]), tight)
    const p = (d: number, m: string) => c.slots.find((s) => s.dayIndex === d && s.meal === m)!.problems
    expect(p(0, 'lunch')).toEqual(['no_candidata'])
    expect(p(0, 'dinner')).toEqual(['veto'])
    expect(p(1, 'lunch')).toEqual(['tiempo'])
    expect(p(1, 'dinner')).toEqual(['equipo'])
    expect(c.extra.map((e) => e.problem).sort()).toEqual(['hueco_duplicado', 'hueco_no_pedido'])
    const missing = checkPlan(out([[0, 'lunch', ref('lentejas')]]), ctx)
    expect(missing.problems.falta).toBe(3)
    const weak = checkPlan(out([[0, 'lunch', ref('crema')], [0, 'dinner', ref('tortilla')], [1, 'lunch', ref('merluza')], [1, 'dinner', ref('lentejas')]]), ctx)
    expect(weak.slots.filter((s) => s.problems.includes('dia_flojo')).map((s) => s.dayIndex)).toEqual([0, 0])
  })

  it('the merge keeps the generator\'s dish wherever the planner failed', () => {
    const generator = gen([['lentejas', 'crema'], ['merluza', 'tortilla']])
    const c = checkPlan(out([[0, 'lunch', ref('merluza')], [0, 'dinner', ref('pasta')], [1, 'lunch', ref('lentejas')], [1, 'dinner', ref('crema')]]), ctx)
    const merged = mergeWithGenerator(generator, c)
    expect(merged.status).toBe('partial')
    expect(merged.fromPlanner).toBe(3)
    const id = (d: number, m: string) => (merged.days[d][m]!.dishes[0] as any).recipeId
    expect([id(0, 'lunch'), id(0, 'dinner'), id(1, 'lunch'), id(1, 'dinner')]).toEqual(['merluza', 'crema', 'lentejas', 'crema'])
    expect(generator[0].lunch!.dishes[0]).toMatchObject({ recipeId: 'lentejas' })
    expect(mergeWithGenerator(generator, checkPlan(out([]), ctx)).status).toBe('fallback')
  })
})

describe('slotsToPlan', () => {
  it('skips locked slots, skipped days and breakfasts', () => {
    const days = gen([['lentejas', 'crema'], ['merluza', 'tortilla'], ['pasta', 'crema']])
    days[0].breakfast = { dishes: [] }
    const s = slotsToPlan(days, { locked: { '0': { lunch: true } }, skippedDays: new Set([2]) })
    expect(s.map((x) => `${x.dayIndex}${x.meal}`)).toEqual(['0dinner', '1lunch', '1dinner'])
  })
})

describe('planMenuInShadow', () => {
  afterEach(() => setCostSinkForTests(null))
  const generator = gen([['lentejas', 'crema'], ['merluza', 'tortilla']])
  const input = { menuId: 'm1', userId: 'u1', weekStart: '2026-10-26', days: generator }
  const candidates = buildPlannerCandidates(ALL, { season: 'autumn', restrictions: ['sin gluten'], dislikes: [] })
  const ref = (id: string) => candidates.find((c) => c.recipe.id === id)!.ref
  const fakeCtx: ShadowContext = {
    householdId: 'h1', recipes: ALL, candidates, restrictions: ['sin gluten'], dislikes: [], prompt: 'PROMPT',
    slots: slotsToPlan(generator), lightDinners: false, fixedRecipeIds: new Set(), season: 'autumn',
  }
  const load = async () => fakeCtx
  const deps = (call: ShadowDeps['call'], over: Partial<ShadowDeps> = {}): ShadowDeps => ({
    db: {} as any, call, capExceeded: async () => false, now: () => new Date('2026-10-20T10:00:00Z'), timeoutMs: 1000, ...over,
  })
  const answer = (slots: object[]) => ({ content: [{ type: 'text', text: JSON.stringify({ slots }) }], stop_reason: 'end_turn', usage: { input_tokens: 10_000, output_tokens: 4_000 } })

  it('asks Claude Opus 5.5 with thinking and the closed format, stores the checked proposal and its cost', async () => {
    const rows: CostRow[] = []
    setCostSinkForTests(async (r) => { rows.push(r) })
    let sent: any
    const row = await planMenuInShadow(input, deps(async (p) => {
      sent = p
      return answer([
        { day: 0, meal: 'lunch', ref: ref('merluza'), why: 'pescado el lunes, que tenéis tiempo', leftoverOfDay: -1, leftoverOfMeal: '' },
        { day: 0, meal: 'dinner', ref: ref('crema'), why: 'cena ligera', leftoverOfDay: -1, leftoverOfMeal: '' },
        { day: 1, meal: 'lunch', ref: ref('lentejas'), why: 'os gustan los guisos', leftoverOfDay: -1, leftoverOfMeal: '' },
        { day: 1, meal: 'dinner', ref: ref('merluza'), why: 'repite', leftoverOfDay: -1, leftoverOfMeal: '' },
      ])
    }), load)
    expect(sent.model).toBe(PLANNER_MODEL)
    expect(PLANNER_MODEL).toBe('claude-opus-5-5')
    expect(sent.thinking).toEqual({ type: 'adaptive' })
    expect(sent.output_config.format.type).toBe('json_schema')
    expect(sent.messages[0].content).toBe('PROMPT')
    expect(row.status).toBe('partial')
    expect((row.check as any).problems).toEqual({ repetido: 1 })
    expect((row.slots as any[]).map((s) => s.source)).toEqual(['planner', 'planner', 'planner', 'generator'])
    expect((row.slots as any[])[0].why).toBe('pescado el lunes, que tenéis tiempo')
    expect(row.plannerScore).toBeTruthy()
    expect(row.generatorScore).toBeTruthy()
    expect(row.costMicros).toBeGreaterThan(0)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ feature: PLANNER_FEATURE, model: PLANNER_MODEL, userId: 'u1', householdId: 'h1' })
    expect(rows[0].costMicros).toBe(row.costMicros)
  })

  it('skips without a key or over the monthly cap, without calling anyone', async () => {
    const call = vi.fn()
    expect((await planMenuInShadow(input, deps(null), load)).reason).toBe('no_key')
    expect((await planMenuInShadow(input, deps(call as any, { capExceeded: async () => true }), load)).reason).toBe('spend_cap')
    expect(call).not.toHaveBeenCalled()
  })

  it('a refusal, a broken answer, an error or a timeout fall back to the generator\'s week', async () => {
    const refusal = await planMenuInShadow(input, deps(async () => ({ content: [], stop_reason: 'refusal', usage: { input_tokens: 1, output_tokens: 1 } })), load)
    expect([refusal.status, refusal.reason]).toEqual(['fallback', 'refusal'])
    expect(refusal.days).toEqual(generator)
    const broken = await planMenuInShadow(input, deps(async () => ({ content: [{ type: 'text', text: '{"nope":1}' }], stop_reason: 'end_turn' })), load)
    expect(broken.reason).toBe('invalid')
    const error = await planMenuInShadow(input, deps(async () => { throw new Error('boom') }), load)
    expect([error.status, error.reason]).toEqual(['fallback', 'error'])
    const slow = await planMenuInShadow(input, deps(() => new Promise(() => {}), { timeoutMs: 5 }), load)
    expect(slow.reason).toBe('timeout')
  })

  it('parses only a complete answer', () => {
    expect(parsePlannerMessage({ content: [{ type: 'text', text: '{"slots":[]}' }], stop_reason: 'max_tokens' })).toBeNull()
    expect(parsePlannerMessage({ content: [{ type: 'text', text: '{"slots":[]}' }], stop_reason: 'end_turn' })).toEqual({ slots: [] })
    expect(buildPlannerRequest('x').max_tokens).toBe(16_000)
  })
})
