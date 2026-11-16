/**
 * PRO-390 — in staging with «Mimo remoto» (MIMO_REMOTO=1) the planner's
 * request goes, as is, to the office's queue (PRO-1102) instead of Anthropic;
 * the answer goes through the same checker (`finishPlan`), costs nothing and
 * the monthly cap doesn't stop it. The Saturday batch doesn't run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {}, pool: {} }))
vi.mock('../config/env.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../config/env.js')>()
  return { ...mod, env: { ...mod.env, MIMO_REMOTO: true, ANTHROPIC_API_KEY: 'sk-test' } }
})

/** The office: keeps each request and answers it with what `office.answer` says. */
const office = vi.hoisted(() => ({ requests: [] as any[], answer: (_req: any): any => null }))
vi.mock('../services/assistant/mimoRemoto.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/assistant/mimoRemoto.js')>()
  const answers = new Map<string, any>()
  return {
    ...mod,
    dbTurnStore: () => ({
      async create(peticion: unknown) {
        const id = `t${office.requests.length}`
        office.requests.push(peticion)
        answers.set(id, office.answer(peticion))
        return id
      },
      async answerOf(id: string) { return answers.get(id) ?? null },
      async expire() { return true },
    }),
  }
})

import type { DayMenu } from '@ona/shared'
import { setCostSinkForTests, type CostRow } from '../services/costLedger.js'
import { buildPlannerCandidates, slotsToPlan, type PlannerRecipe } from '../services/menuPlanner.js'
import { REMOTE_PLANNER_WAIT_MS, buildPlannerRequest, defaultShadowDeps, planMenuInShadow, type ShadowContext } from '../services/menuPlannerShadow.js'
import { PLANNER_TIMEOUT_MS } from '../services/menuPlanner.js'
import { runWeeklyPlannerIfDue } from '../services/menuPlannerWeekly.js'

const rec = (id: string, name: string, over: Partial<PlannerRecipe> = {}): PlannerRecipe => ({
  id, name, meals: ['lunch', 'dinner'], seasons: [], tags: [], equipment: [], course: 'main',
  ingredients: [{ ingredientId: `${id}-i`, ingredientName: name, quantity: 100, unit: 'g' }], totalTime: 20, nutritionPerServing: { kcal: 450 },
  ...over,
})
const ALL = [rec('lentejas', 'Lentejas'), rec('merluza', 'Merluza'), rec('crema', 'Crema de calabacín'), rec('pasta', 'Macarrones', { allergens: ['gluten'] })]
const generator: DayMenu[] = [{
  lunch: { dishes: [{ kind: 'recipe', recipeId: 'lentejas', recipeName: 'Lentejas', course: 'main' }] },
  dinner: { dishes: [{ kind: 'recipe', recipeId: 'crema', recipeName: 'Crema de calabacín', course: 'main' }] },
}]
// The pasta is a candidate here on purpose: the checker, not the candidate list, must stop it.
const candidates = buildPlannerCandidates(ALL, { season: 'autumn', restrictions: [], dislikes: [] })
const ref = (id: string) => candidates.find((c) => c.recipe.id === id)!.ref
const ctx: ShadowContext = {
  householdId: 'h1', recipes: ALL, candidates, restrictions: ['sin gluten'], dislikes: [], prompt: 'PROMPT',
  slots: slotsToPlan(generator), lightDinners: false, fixedRecipeIds: new Set(), season: 'autumn',
}
const input = { menuId: 'm1', userId: 'u1', weekStart: '2026-11-16', days: generator }

describe('the planner with «Mimo remoto» (staging)', () => {
  afterEach(() => { setCostSinkForTests(null); office.requests.length = 0 })

  it('sends the request as is to the office; its answer goes through the checker; no cost, no cap', async () => {
    const costs: CostRow[] = []
    setCostSinkForTests(async (r) => { costs.push(r) })
    office.answer = () => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ slots: [
        { day: 0, meal: 'lunch', ref: ref('merluza'), why: 'pescado', leftoverOfDay: -1, leftoverOfMeal: '' },
        { day: 0, meal: 'dinner', ref: ref('pasta'), why: 'rápida', leftoverOfDay: -1, leftoverOfMeal: '' },
      ] }) }],
    })
    const deps = defaultShadowDeps()
    expect(await deps.capExceeded('u1')).toBe(false)
    const row = await planMenuInShadow(input, deps, async () => ctx)

    expect(office.requests).toEqual([buildPlannerRequest('PROMPT')])
    expect(row.status).toBe('partial')
    expect((row.check as any).problems).toMatchObject({ restriccion: 1 })
    expect((row.slots as any[]).map((s) => s.source)).toEqual(['planner', 'generator'])
    expect(row.costMicros).toBeNull()
    expect(costs).toHaveLength(0)
    expect(REMOTE_PLANNER_WAIT_MS).toBeLessThan(PLANNER_TIMEOUT_MS)
  })

  it('the Saturday batch doesn\'t run (nothing goes to Anthropic)', async () => {
    expect(await runWeeklyPlannerIfDue(new Date('2026-11-14T21:30:00Z'))).toBeNull()
  })
})
