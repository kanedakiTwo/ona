/**
 * PRO-284 — realistic totals: prep done while something goes by itself
 * (oven, low heat, pot, resting) is not counted twice, the prep is made
 * realistic once, and the cook time is never touched.
 */
import { describe, expect, it } from 'vitest'
import {
  isDayBeforeStep,
  passiveMinutes,
  planTimeTrim,
  realisticPrep,
  trimLogLine,
  withinLimit,
} from '../services/recipeTimeTrim.js'
import { REWRITE_PROMPT } from '../services/catalogRewriter.js'

const oven40 = [
  { text: 'Picar la cebolla, el ajo y el pimiento' },
  { text: 'Preparar la salsa y la guarnición' },
  { text: 'Hornear 40 minutos a 200 °C', durationMin: 40 },
]

describe('the total rule', () => {
  it('a 40-minute oven with 20 of prep that can be done meanwhile: total ≥ 40 and < 60, cook unchanged, work ≤ total', () => {
    const row = { prepTime: 20, cookTime: 40, activeTime: 20, totalTime: 60 }
    for (const trimPrep of [true, false]) {
      const t = planTimeTrim(row, oven40, { trimPrep })
      expect(t.totalTime).toBeGreaterThanOrEqual(40)
      expect(t.totalTime).toBeLessThan(60)
      expect(t.activeTime!).toBeLessThanOrEqual(t.totalTime!)
      expect(t).not.toHaveProperty('cookTime')
    }
    expect(planTimeTrim(row, oven40, { trimPrep: true })).toMatchObject({ prepTime: 16, totalTime: 48, activeTime: 16, overlap: 8 })
  })

  it('never below the cook time, even with long prep and a long oven', () => {
    const t = planTimeTrim({ prepTime: 60, cookTime: 120, activeTime: 60, totalTime: 180 }, [{ text: 'Hornear 120 minutos', durationMin: 120 }], { trimPrep: true })
    expect(t.totalTime).toBeGreaterThanOrEqual(120)
    expect(t.totalTime).toBe(48 + 120 - 24)
  })

  it('never above the total it had (a total Cocina set below prep + cook stays)', () => {
    const t = planTimeTrim({ prepTime: 20, cookTime: 40, activeTime: 20, totalTime: 45 }, oven40, { trimPrep: false })
    expect(t.totalTime).toBe(45)
  })

  it('without steps that go by themselves only the prep comes down', () => {
    const t = planTimeTrim({ prepTime: 10, cookTime: 15, activeTime: 10, totalTime: 25 }, [{ text: 'Saltear las verduras' }], { trimPrep: true })
    expect(t).toMatchObject({ prepTime: 8, totalTime: 23, activeTime: 8, overlap: 0 })
  })

  it('a passive step without minutes: the cook time stands in for it', () => {
    const t = planTimeTrim({ prepTime: 20, cookTime: 30, activeTime: 20, totalTime: 50 }, [{ text: 'Picar todo' }, { text: 'Hornear hasta que se dore' }], { trimPrep: false })
    expect(t).toMatchObject({ totalTime: 40, overlap: 10 })
  })

  it('soaking the night before is not part of the time and gives no overlap', () => {
    expect(isDayBeforeStep({ text: 'Dejar las lentejas en remojo 12 horas' })).toBe(true)
    expect(isDayBeforeStep({ text: 'Poner los garbanzos en agua la noche anterior' })).toBe(true)
    expect(passiveMinutes([{ text: 'Dejar en remojo 12 horas' }, { text: 'Cocer 30 minutos' }])).toEqual({ minutes: 30, unknown: false })
  })

  it('Codillo al estilo alemán (45 prep, 100 total): the purée and the sauce are made while it is in the oven', () => {
    const steps = [
      { text: 'Cocer el codillo 40 minutos', durationMin: 40 },
      { text: 'Hornear 15 minutos hasta dorar', durationMin: 15 },
      { text: 'Hacer el puré y la salsa' },
    ]
    const t = planTimeTrim({ prepTime: 45, cookTime: 55, activeTime: 45, totalTime: 100 }, steps, { trimPrep: true })
    expect(t.totalTime).toBeLessThan(80)
    expect(t.totalTime).toBeGreaterThanOrEqual(55)
  })

  it('a recipe with no time at all stays without time', () => {
    expect(planTimeTrim({ prepTime: null, cookTime: null, activeTime: null, totalTime: null }, [], { trimPrep: true })).toMatchObject({ prepTime: null, totalTime: null, activeTime: null })
  })
})

describe('idempotent', () => {
  it('a second run (prep already realistic) changes nothing', () => {
    const rows = [
      { prepTime: 20, cookTime: 40, activeTime: 20, totalTime: 60 },
      { prepTime: 10, cookTime: 15, activeTime: 25, totalTime: 25 },
      { prepTime: 25, cookTime: 35, activeTime: 30, totalTime: 60 },
    ]
    for (const row of rows) {
      const once = planTimeTrim(row, oven40, { trimPrep: true })
      const again = planTimeTrim({ ...row, ...once }, oven40, { trimPrep: false })
      expect({ ...again, overlap: 0 }).toEqual({ ...once, overlap: 0 })
    }
  })

  it('an admin edit that puts the total back to prep + cook gets the same total on the next boot', () => {
    const once = planTimeTrim({ prepTime: 20, cookTime: 40, activeTime: 20, totalTime: 60 }, oven40, { trimPrep: true })
    const edited = { ...once, totalTime: once.prepTime! + 40, cookTime: 40 }
    expect(planTimeTrim(edited, oven40, { trimPrep: false }).totalTime).toBe(once.totalTime)
  })
})

describe('hands-on time («de trabajo»)', () => {
  it('drops by what the prep dropped and never goes above the total', () => {
    const t = planTimeTrim({ prepTime: 15, cookTime: 10, activeTime: 30, totalTime: 25 }, [], { trimPrep: true })
    expect(t.prepTime).toBe(12)
    expect(t.activeTime).toBeLessThanOrEqual(t.totalTime!)
  })

  it('never goes up', () => {
    const t = planTimeTrim({ prepTime: 30, cookTime: 20, activeTime: 10, totalTime: 50 }, [], { trimPrep: true })
    expect(t.activeTime).toBe(10)
  })
})

describe('helpers', () => {
  it('realistic prep: × 0.8, not below 5 min', () => {
    expect(realisticPrep(45)).toBe(36)
    expect(realisticPrep(6)).toBe(5)
    expect(realisticPrep(4)).toBe(4)
  })

  it('the 30-minute limit', () => {
    expect(withinLimit(30)).toBe(true)
    expect(withinLimit(31)).toBe(false)
    expect(withinLimit(null)).toBeNull()
  })

  it('the log line says before → after and that the cook time is unchanged', () => {
    const before = { prepTime: 20, cookTime: 40, activeTime: 20, totalTime: 60 }
    const line = trimLogLine('Pollo al horno', before, planTimeTrim(before, oven40, { trimPrep: true }))
    expect(line).toBe('[catalog-time-trim] «Pollo al horno»: preparación 20 → 16 · total 60 → 48 · trabajo 20 → 16 min (cocción 40, sin cambios; 8 min de preparación mientras va solo)')
    expect(trimLogLine('X', before, { ...before, overlap: 0 })).toBeNull()
  })

  it('the batch rewriter is told that prep done meanwhile is not counted twice', () => {
    expect(REWRITE_PROMPT).toMatch(/se hace a la vez/)
    expect(REWRITE_PROMPT).toMatch(/cocina en casa con soltura/)
  })
})

describe('the mark survives an edit (PUT /recipes/:id)', () => {
  it('a body without internalTags keeps the recipe’s; one with them uses its own', async () => {
    const { withKeptInternalTags } = await import('../routes/recipes.js')
    expect(withKeptInternalTags({ name: 'X' } as { name: string; internalTags?: string[] }, ['compartida', 'tiempos-pro284']).internalTags).toEqual(['compartida', 'tiempos-pro284'])
    expect(withKeptInternalTags({ name: 'X', internalTags: ['otra'] }, ['compartida']).internalTags).toEqual(['otra'])
    expect(withKeptInternalTags({ name: 'X' } as { name: string; internalTags?: string[] }, null).internalTags).toEqual([])
  })
})

describe('the steps that go by themselves set a floor', () => {
  it('a 30-minute oven keeps the total at 30 or more even if the cook time says 15', () => {
    const t = planTimeTrim({ prepTime: 35, cookTime: 15, activeTime: 35, totalTime: 50 }, [{ text: 'Mezclar en el procesador' }, { text: 'Hornear 30 minutos', durationMin: 30 }], { trimPrep: true })
    expect(t.totalTime).toBeGreaterThanOrEqual(30)
    expect(t.totalTime).toBeLessThan(50)
  })
})
