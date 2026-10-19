/**
 * PRO-256 — comparación a ciegas (specs/smart-menu.md): A/B fixed per menu
 * and balanced, weeks without anything that gives away their origin, the
 * pick mapped back, and the per-household report.
 */
import { describe, expect, it } from 'vitest'
import type { DayMenu } from '@ona/shared'
import { blindPair, blindSources, blindWeek, isBlindTestAccount, preferredSource, summarizeComparison } from '../services/blindComparison.js'

const planner: DayMenu[] = [{ lunch: { dishes: [{ kind: 'recipe', recipeId: 'r1', recipeName: 'Lentejas', why: 'os gustan los guisos', course: 'main' }] }, dinner: { dishes: [{ kind: 'recipe', recipeId: 'r2', recipeName: 'Lentejas', variant: 'leftover' }] } }]
const generator: DayMenu[] = [{ lunch: { dishes: [{ kind: 'recipe', recipeId: 'r3', recipeName: 'Pollo asado' }, { kind: 'note', text: 'pan' }] } }]

describe('blind comparison', () => {
  it('only test accounts (@example.com) take part', () => {
    expect(isBlindTestAccount('laura@example.com')).toBe(true)
    expect(isBlindTestAccount('Laura@Example.com ')).toBe(true)
    expect(isBlindTestAccount('laura@gmail.com')).toBe(false)
    expect(isBlindTestAccount(null)).toBe(false)
  })

  it('which week is A is fixed per menu and about half and half across menus', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(blindSources(id)).toEqual(blindSources(id))
    const firsts = Array.from({ length: 200 }, (_, i) => blindSources(`menu-${i}`).A)
    const planners = firsts.filter((s) => s === 'planner').length
    expect(planners).toBeGreaterThan(70)
    expect(planners).toBeLessThan(130)
  })

  it('a week shows only days, meals and dish names — never the why or ids', () => {
    const w = blindWeek(planner)
    expect(w).toEqual([{ day: 'lunes', meals: [{ meal: 'comida', dishes: ['Lentejas'] }, { meal: 'cena', dishes: ['Lentejas (sobras)'] }] }])
    const pair = blindPair('m1', planner, generator)
    const json = JSON.stringify(pair)
    expect(json).not.toMatch(/why|guisos|r1|recipeId|planner|generator/)
    expect([pair.A, pair.B]).toContainEqual(blindWeek(generator))
  })

  it('the pick is mapped back to its source', () => {
    const s = blindSources('m1')
    expect(preferredSource('m1', 'A')).toBe(s.A)
    expect(preferredSource('m1', 'B')).toBe(s.B)
    expect(preferredSource('m1', 'igual')).toBe('tie')
  })

  it('the report has one line per household: plans, checker problems, Cocina\'s rules for both weeks and the votes', () => {
    const rows = summarizeComparison(
      [
        { householdId: 'h1', status: 'ok', check: { problems: {} }, plannerScore: { score: 0.9 }, generatorScore: { score: 0.6 } },
        { householdId: 'h1', status: 'partial', check: { problems: { repetido: 1, restriccion: 1 } }, plannerScore: { score: 0.7 }, generatorScore: { score: 0.8 } },
        { householdId: 'h2', status: 'fallback', check: null, plannerScore: null, generatorScore: { score: 0.5 } },
      ],
      [
        { householdId: 'h1', preferred: 'planner', reason: 'Más variada' },
        { householdId: 'h1', preferred: 'generator', reason: null },
        { householdId: 'h1', preferred: 'planner', reason: '' },
      ],
    )
    const h1 = rows.find((r) => r.householdId === 'h1')!
    expect(h1).toMatchObject({ plans: 2, byStatus: { ok: 1, partial: 1 }, problems: { repetido: 1, restriccion: 1 }, plannerRules: 80, generatorRules: 70, votes: { planner: 2, generator: 1, tie: 0 }, prefersPlanner: true })
    expect(h1.reasons).toEqual([{ preferred: 'planner', reason: 'Más variada' }])
    expect(rows.find((r) => r.householdId === 'h2')).toMatchObject({ plannerRules: null, generatorRules: 50, prefersPlanner: null })
  })
})
