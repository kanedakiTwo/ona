/**
 * Onboarding answers now shape the first menu (they used to be stored and
 * ignored): favourite dishes weigh like favourites, "Rapidez" / "Cocino poco"
 * caps weekday total time, and breakfast is no longer on by default.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {}, pool: {} }))

import { dishWords, weekTimeBudgets, recipesMatchingDishes, QUICK_WEEKDAY_PREP_MINUTES } from '../services/onboardingPreferences.js'
import { defaultTemplate } from '../services/menuGenerator.js'

const RECIPES = [
  { id: 'r1', name: 'Pollo al curry' },
  { id: 'r2', name: 'Lentejas estofadas' },
  { id: 'r3', name: 'Espaguetis con ajo y aceite' },
  { id: 'r4', name: 'Crema de calabaza' },
]

describe('favourite dishes', () => {
  it('extracts significant words', () => {
    expect(dishWords('Lentejas con chorizo')).toEqual(['lentejas', 'chorizo'])
    expect(dishWords('Pollo al curry de mi madre')).toEqual(['pollo', 'curry', 'madre'])
  })

  it('matches recipes sharing a word (accent/plural tolerant)', () => {
    expect([...recipesMatchingDishes(RECIPES, ['pollo', 'Lenteja', 'espagueti'])].sort()).toEqual(['r1', 'r2', 'r3'])
    expect(recipesMatchingDishes(RECIPES, []).size).toBe(0)
    expect(recipesMatchingDishes(RECIPES, null).size).toBe(0)
  })
})

describe('weekly time limits (PRO-138)', () => {
  const total30 = { mode: 'total', minutes: 30 }

  it('"quick" or "rarely" with no answer → 30 min in total on weekdays only', () => {
    const quick = weekTimeBudgets(undefined, { priority: 'quick' })
    expect(quick).toEqual({ 0: total30, 1: total30, 2: total30, 3: total30, 4: total30 })
    expect(weekTimeBudgets(null, { cookingFreq: 'rarely' })[0]).toEqual({ mode: 'total', minutes: QUICK_WEEKDAY_PREP_MINUTES })
  })

  it('a stored time_available wins, in both shapes; other answers change nothing', () => {
    expect(weekTimeBudgets({ miercoles: 45 }, { priority: 'quick' })).toEqual({ 2: { mode: 'total', minutes: 45 } })
    expect(weekTimeBudgets({ lunes: { mode: 'activo', minutes: 20 } }, {})).toEqual({ 0: { mode: 'activo', minutes: 20 } })
    expect(weekTimeBudgets(undefined, { priority: 'healthy', cookingFreq: 'daily' })).toEqual({})
  })

  it('«Sin prisa» (an empty time_available) means no limit, even with "Rapidez"', () => {
    expect(weekTimeBudgets({}, { priority: 'quick', cookingFreq: 'rarely' })).toEqual({})
  })
})

describe('default meal template', () => {
  it('is lunch + dinner, no breakfast', () => {
    const t = defaultTemplate()
    expect(t).toHaveLength(7)
    expect(t.every((d) => d.lunch && d.dinner && !d.breakfast)).toBe(true)
  })
})
