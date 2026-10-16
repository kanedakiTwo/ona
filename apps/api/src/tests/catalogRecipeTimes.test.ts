/**
 * PRO-138 (4) — every catalogue recipe needs a total and a hands-on time,
 * because with a day limit a recipe without the time it is about no longer
 * passes. A boot-time data fix fills only the empty fields of system recipes.
 */
import { describe, expect, it } from 'vitest'
import {
  CATALOG_RECIPE_TIMES,
  computeActiveTime,
  isPassiveStep,
  knownTimesFor,
  planRecipeTimes,
  stepMinutes,
} from '../services/catalogRecipeTimes.js'
import { normalizeRecipeName } from '../services/catalogSourceLinks.js'
import { seedRecipes } from '../seed/recipes.js'
import catalog from './fixtures/catalog-2026-10-12.json'

const empty = { prepTime: null, cookTime: null, activeTime: null, totalTime: null }

describe('the recipes that had no time', () => {
  it('get the times Cocina gave, and all of them are in the production catalogue', () => {
    const names = new Set((catalog as Array<{ name: string }>).map((r) => normalizeRecipeName(r.name)))
    expect(CATALOG_RECIPE_TIMES).toHaveLength(10)
    for (const t of CATALOG_RECIPE_TIMES) {
      expect(names.has(normalizeRecipeName(t.name)), t.name).toBe(true)
      expect(t.prepTime + t.cookTime).toBeLessThanOrEqual(t.totalTime)
    }
    expect(knownTimesFor('Cocido madrileno')).toMatchObject({ prepTime: 20, cookTime: 180, totalTime: 200 })
  })

  it('Cocido madrileño: 20 of work, 200 in total (the soaking the night before is not work)', () => {
    const cocido = seedRecipes.find((r) => r.name === 'Cocido madrileño')!
    const patch = planRecipeTimes({ name: cocido.name, ...empty }, cocido.steps.map((text) => ({ text })))
    expect(patch).toMatchObject({ prepTime: 20, cookTime: 180, totalTime: 200, activeTime: 20 })
  })
})

describe('the data fix fills only what is empty', () => {
  it('never touches a time someone already set', () => {
    const patch = planRecipeTimes(
      { name: 'Lentejas guisadas', prepTime: 12, cookTime: null, activeTime: 9, totalTime: 70 },
      [],
    )
    expect(patch).toEqual({ cookTime: 45 })
  })

  it('a recipe with every time is left alone', () => {
    expect(planRecipeTimes({ name: 'Falafel', prepTime: 30, cookTime: 20, activeTime: 25, totalTime: 50 }, [])).toEqual({})
  })

  it('total = prep + cook when missing; hands-on from the steps', () => {
    const patch = planRecipeTimes({ name: 'Guiso', prepTime: 15, cookTime: 60, activeTime: null, totalTime: null }, [
      { text: 'Picar la cebolla y el pimiento', durationMin: 10 },
      { text: 'Sofreír', durationMin: 8 },
      { text: 'Cocer a fuego lento 60 minutos', durationMin: 60 },
    ])
    expect(patch).toMatchObject({ totalTime: 75, activeTime: 18, activeFrom: 'pasos' })
  })

  it('a recipe with nothing to go on stays without time (and the log says so)', () => {
    expect(planRecipeTimes({ name: 'Sin datos', ...empty }, [{ text: 'Mezclar' }])).toEqual({})
  })
})

describe('hands-on time from the steps', () => {
  it('simmering, oven, resting, marinating and soaking steps do not count', () => {
    expect(isPassiveStep({ text: 'Tapar y dejar a fuego bajo 25 minutos' })).toBe(true)
    expect(isPassiveStep({ text: 'Hornear 30 minutos a 200 °C' })).toBe(true)
    expect(isPassiveStep({ text: 'Dejar reposar 10 minutos' })).toBe(true)
    expect(isPassiveStep({ text: 'Dejar marinar la carne' })).toBe(true)
    expect(isPassiveStep({ text: 'Poner los garbanzos en remojo' })).toBe(true)
    expect(isPassiveStep({ text: 'Mezclar', technique: 'hornear' })).toBe(true)
    expect(isPassiveStep({ text: 'Picar la cebolla muy menuda' })).toBe(false)
  })

  it('reads minutes from durationMin or the text', () => {
    expect(stepMinutes({ text: 'x', durationMin: 7 })).toBe(7)
    expect(stepMinutes({ text: 'Cocer patatas 5 min, añadir pencas 5 min, añadir hojas 5 min' })).toBe(15)
    expect(stepMinutes({ text: 'Dejar reposar 5-10 minutos' })).toBe(10)
    expect(stepMinutes({ text: 'Cocer 1 hora' })).toBe(60)
    expect(stepMinutes({ text: 'Picar' })).toBeNull()
  })

  it('a hands-on step without minutes → prepTime; never more than the total', () => {
    expect(computeActiveTime([{ text: 'Picar' }, { text: 'Sofreír 5 min' }], 15)).toBe(15)
    expect(computeActiveTime([{ text: 'Batir 40 min' }], 10, 30)).toBe(30)
    expect(computeActiveTime([], null)).toBeNull()
  })
})

describe('the catalogue after the fix', () => {
  it('every recipe that had a prep time or Cocina times ends up with a total and a hands-on time', () => {
    // The seed is the catalogue a fresh database gets: run the same plan over it.
    for (const r of seedRecipes) {
      const known = knownTimesFor(r.name)
      if (!known && !(r.prepTime > 0)) continue
      const row = { name: r.name, prepTime: r.prepTime > 0 ? r.prepTime : null, cookTime: null, activeTime: null, totalTime: null }
      const after = { ...row, ...planRecipeTimes(row, r.steps.map((text) => ({ text }))) }
      expect(after.totalTime, r.name).toBeGreaterThan(0)
      expect(after.activeTime, r.name).toBeGreaterThan(0)
      expect(after.activeTime!, r.name).toBeLessThanOrEqual(after.totalTime!)
    }
  })
})
