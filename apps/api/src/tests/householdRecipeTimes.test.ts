/**
 * PRO-1037 (Marta y Jorge; Dani y Sara, 2026-10-24 → 2026-11-18): the
 * recipes Mimo created before PRO-308 («Merluza a la plancha con ensalada»,
 * «Salmón a la plancha con calabacín», tacos, fajitas) kept `totalTime: null`
 * and showed «SIN TIEMPO». A boot fill gives every household recipe without
 * time the catalogue's estimate, marked as estimated.
 */
import { describe, expect, it } from 'vitest'
import { planHouseholdRecipeTimes, TIMES_ESTIMATED_TAG } from '../services/householdRecipeTimes.js'
import { recipeDetailsSummary } from '../services/assistant/skills.js'

const MERLUZA_STEPS = [
  { text: 'Sala los lomos de merluza.' },
  { text: 'Hazlos a la plancha 4 minutos por cada lado.' },
  { text: 'Aliña la ensalada.' },
]

describe('planHouseholdRecipeTimes', () => {
  it('a recipe without minutes gets total and hands-on time from its steps', () => {
    // Two hands-on steps without minutes (5 each) and the plancha (the 4 minutes its text says).
    expect(planHouseholdRecipeTimes({ prepTime: null, cookTime: null, totalTime: null }, MERLUZA_STEPS)).toEqual({
      prepTime: 14,
      cookTime: 0,
      activeTime: 14,
      totalTime: 14,
    })
  })

  it('the saved minutes of a step and the times it has win', () => {
    const steps = [{ text: 'Corta las verduras', durationMin: 10 }, { text: 'Hornea', durationMin: 30 }]
    expect(planHouseholdRecipeTimes({ prepTime: null, cookTime: null, totalTime: null }, steps)).toMatchObject({ totalTime: 40, activeTime: 10 })
    expect(planHouseholdRecipeTimes({ prepTime: 10, cookTime: null, totalTime: null }, steps)).toMatchObject({ prepTime: 10, totalTime: 10 })
  })

  it('a recipe with its time, or with nothing to estimate from, is left alone', () => {
    expect(planHouseholdRecipeTimes({ prepTime: 5, cookTime: 10, totalTime: 15 }, MERLUZA_STEPS)).toBeNull()
    expect(planHouseholdRecipeTimes({ prepTime: null, cookTime: null, totalTime: null }, [])).toBeNull()
    expect(planHouseholdRecipeTimes({ prepTime: 0, cookTime: 0, totalTime: 0 }, [{ text: '  ' }])).toBeNull()
  })
})

describe('Mimo says the minutes are estimated', () => {
  it('recipeDetailsSummary', () => {
    const base = { name: 'Merluza a la plancha con ensalada', totalTime: 18, activeTime: 18, servings: 2, ingredients: [], steps: [] }
    expect(recipeDetailsSummary({ ...base, timesEstimated: true })).toMatch(/^Merluza a la plancha con ensalada \(18 min[^)]*, estimado, 2 raciones\)/)
    expect(recipeDetailsSummary(base)).not.toMatch(/estimado/)
    expect(recipeDetailsSummary({ ...base, totalTime: null, activeTime: null, timesEstimated: true })).toMatch(/\(\? min/)
  })

  it('the tag is an internal one', () => {
    expect(TIMES_ESTIMATED_TAG).toBe('times-estimated')
  })
})
