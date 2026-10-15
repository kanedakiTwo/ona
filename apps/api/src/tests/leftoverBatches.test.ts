/**
 * PRO-75: the shopping list counted a planned leftover ("táper") as another
 * cooking. Laura's lasaña "Solo hoy: 2" on Monday + leftover on Tuesday
 * bought 4 servings (the leftover copied the 2 and the list added 2 + 2).
 *
 * Rule (Miguel, 2026-10-13, option A): if the source meal has «Solo hoy: N»,
 * N is what gets cooked (táper included) and the leftover adds nothing; if
 * not, each leftover adds the household's diners.
 */
import { describe, expect, it } from 'vitest'
import type { DayMenu, MealSlot } from '@ona/shared'
import { sumDinersByRecipe, withLeftoverBatches } from '../services/shoppingList.js'
import { batchServings } from '../../../web/src/lib/menuDay'

const cooked = (recipeId: string, servings?: number): MealSlot => ({
  ...(servings != null ? { servings } : {}),
  dishes: [{ kind: 'recipe', recipeId, recipeName: recipeId }],
})
const leftover = (recipeId: string, from: { day: number; meal: string }, servings?: number): MealSlot => ({
  ...(servings != null ? { servings } : {}),
  dishes: [{ kind: 'recipe', recipeId, recipeName: recipeId, variant: 'leftover', leftoverOf: { ...from, dishPosition: 0 } }],
})

const dinersFor = (days: DayMenu[], household: number, recipeId = 'lasana') =>
  sumDinersByRecipe(withLeftoverBatches(days), household).get(recipeId)

describe('withLeftoverBatches + sumDinersByRecipe (PRO-75)', () => {
  it('household of 1, Monday «Solo hoy: 2» + leftover on Tuesday → 2 servings', () => {
    const days: DayMenu[] = [{ dinner: cooked('lasana', 2) }, { lunch: leftover('lasana', { day: 0, meal: 'dinner' }) }]
    expect(dinersFor(days, 1)).toBe(2)
  })

  it('a leftover created before the fix (it copied the source «Solo hoy: 2») still adds nothing', () => {
    const days: DayMenu[] = [{ dinner: cooked('lasana', 2) }, { lunch: leftover('lasana', { day: 0, meal: 'dinner' }, 2) }]
    expect(dinersFor(days, 1)).toBe(2)
  })

  it('household of 1 without «Solo hoy» + leftover → 2', () => {
    const days: DayMenu[] = [{ dinner: cooked('lasana') }, { lunch: leftover('lasana', { day: 0, meal: 'dinner' }) }]
    expect(dinersFor(days, 1)).toBe(2)
  })

  it('household of 2 without «Solo hoy» + leftover → 4', () => {
    const days: DayMenu[] = [{ dinner: cooked('lasana') }, { lunch: leftover('lasana', { day: 0, meal: 'dinner' }) }]
    expect(dinersFor(days, 2)).toBe(4)
  })

  it('curry for 2 on Thursday with leftovers on Saturday (Laura, 2026-10-14) → 2', () => {
    const days: DayMenu[] = [{}, {}, {}, { dinner: cooked('curry', 2) }, {}, { lunch: leftover('curry', { day: 3, meal: 'dinner' }) }]
    expect(dinersFor(days, 1, 'curry')).toBe(2)
  })

  it('a leftover whose source no longer holds the recipe counts as before (its own diners)', () => {
    const days: DayMenu[] = [{ dinner: cooked('otra', 2) }, { lunch: leftover('lasana', { day: 0, meal: 'dinner' }) }]
    expect(dinersFor(days, 2)).toBe(2)
  })

  it('does not mutate the menu it is given', () => {
    const days: DayMenu[] = [{ dinner: cooked('lasana', 2) }, { lunch: leftover('lasana', { day: 0, meal: 'dinner' }) }]
    const before = JSON.stringify(days)
    withLeftoverBatches(days)
    expect(JSON.stringify(days)).toBe(before)
  })
})

describe('batchServings — the recipe opens at what the batch cooks (PRO-75)', () => {
  it('source «Solo hoy: 2» with a leftover → the recipe opens for 2', () => {
    const days: DayMenu[] = [{ dinner: cooked('lasana', 2) }, { lunch: leftover('lasana', { day: 0, meal: 'dinner' }) }]
    expect(batchServings(days, 0, 'dinner', 1)).toBe(2)
  })

  it('source without «Solo hoy» → household + each leftover', () => {
    const days: DayMenu[] = [{ dinner: cooked('lasana') }, { lunch: leftover('lasana', { day: 0, meal: 'dinner' }) }]
    expect(batchServings(days, 0, 'dinner', 2)).toBe(4)
  })

  it('a leftover slot and a plain meal open at their own diners', () => {
    const days: DayMenu[] = [{ dinner: cooked('lasana') }, { lunch: leftover('lasana', { day: 0, meal: 'dinner' }), dinner: cooked('crema', 3) }]
    expect(batchServings(days, 1, 'lunch', 2)).toBe(2)
    expect(batchServings(days, 1, 'dinner', 2)).toBe(3)
  })
})
