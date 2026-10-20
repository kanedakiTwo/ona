/**
 * PRO-183 — the menu facts Mimo cites must be the app's: servings per meal
 * (mirror of `batchServings`, apps/web/src/lib/menuDay.ts) and each dish's
 * total / hands-on minutes.
 */
import { describe, it, expect } from 'vitest'
import { cookedRecipeIds, householdDiners, mealLinesWithFacts, mealServings, timesLabel } from '../services/assistant/menuFacts.js'

const recipe = (recipeId: string, recipeName: string, extra: Record<string, unknown> = {}) => ({ kind: 'recipe', recipeId, recipeName, ...extra })

describe('householdDiners', () => {
  it('adults + kids, at least 1, 2 when unknown (as the menu page)', () => {
    expect(householdDiners({ adults: 2, kidsCount: 2 })).toBe(4)
    expect(householdDiners({ adults: 1, kidsCount: 0 })).toBe(1)
    expect(householdDiners({})).toBe(2)
    expect(householdDiners(null)).toBe(2)
  })
})

describe('mealServings', () => {
  it('«Solo hoy: N» wins; otherwise the household plus its planned leftovers', () => {
    const days: any[] = [
      { dinner: { dishes: [recipe('a', 'Lentejas')] } },
      { lunch: { dishes: [recipe('a', 'Lentejas', { variant: 'leftover', leftoverOf: { day: 0, meal: 'dinner', dishPosition: 0 } })] } },
      { lunch: { servings: 5, dishes: [recipe('b', 'Paella')] } },
    ]
    expect(mealServings(days, 0, 'dinner', 2)).toBe(4)
    expect(mealServings(days, 1, 'lunch', 2)).toBe(2)
    expect(mealServings(days, 2, 'lunch', 2)).toBe(5)
  })
})

describe('timesLabel', () => {
  it('total and hands-on minutes; prepTime when there is no total', () => {
    expect(timesLabel({ totalTime: 25, activeTime: 10 })).toBe('25 min en total, 10 de trabajo')
    expect(timesLabel({ totalTime: 20, activeTime: 20 })).toBe('20 min')
    expect(timesLabel({ prepTime: 15 })).toBe('15 min')
    expect(timesLabel({})).toBeNull()
  })
})

describe('mealLinesWithFacts', () => {
  it('a recipe for 2 in a meal of 4: «4 raciones» and its minutes; leftovers and notes without minutes', () => {
    const days: any[] = [
      {
        lunch: { servings: 4, dishes: [recipe('pollo', 'Pollo a la plancha'), recipe('ens', 'Ensalada verde')] },
        dinner: { dishes: [{ kind: 'note', text: 'Cenamos fuera' }, recipe('crema', 'Crema de calabaza', { variant: 'leftover' })] },
      },
    ]
    const times = new Map([['pollo', { totalTime: 25, activeTime: 10 }], ['ens', { prepTime: 5 }], ['crema', { totalTime: 40 }]])
    expect(mealLinesWithFacts(days, 0, times, 2)).toEqual([
      'comida [solo hoy: 4] · 4 raciones: Pollo a la plancha (25 min en total, 10 de trabajo) + Ensalada verde (5 min)',
      'cena · 2 raciones: Cenamos fuera + Crema de calabaza (sobras)',
    ])
    expect(cookedRecipeIds(days)).toEqual(['pollo', 'ens'])
  })
})
