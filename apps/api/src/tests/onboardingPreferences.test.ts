/**
 * Onboarding answers now shape the first menu (they used to be stored and
 * ignored): favourite dishes weigh like favourites, "Rapidez" / "Cocino poco"
 * caps weekday prep time, and breakfast is no longer on by default.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {}, pool: {} }))

import { dishWords, prepBudgetByDay, recipesMatchingDishes, QUICK_WEEKDAY_PREP_MINUTES } from '../services/onboardingPreferences.js'
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

describe('prep-time budget', () => {
  it('"quick" or "rarely" → 30 min on weekdays only', () => {
    const quick = prepBudgetByDay({}, { priority: 'quick' })
    expect(quick).toEqual({ 0: 30, 1: 30, 2: 30, 3: 30, 4: 30 })
    expect(prepBudgetByDay({}, { cookingFreq: 'rarely' })[0]).toBe(QUICK_WEEKDAY_PREP_MINUTES)
  })

  it('explicit time_available wins; other answers change nothing', () => {
    expect(prepBudgetByDay({ 2: 45 }, { priority: 'quick' })).toEqual({ 2: 45 })
    expect(prepBudgetByDay({}, { priority: 'healthy', cookingFreq: 'daily' })).toEqual({})
  })
})

describe('default meal template', () => {
  it('is lunch + dinner, no breakfast', () => {
    const t = defaultTemplate()
    expect(t).toHaveLength(7)
    expect(t.every((d) => d.lunch && d.dinner && !d.breakfast)).toBe(true)
  })
})
