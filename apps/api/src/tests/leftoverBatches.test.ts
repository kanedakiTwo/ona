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
  sumDinersByRecipe(withLeftoverBatches(days, household), household).get(recipeId)

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
    withLeftoverBatches(days, 1)
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

/**
 * PRO-298 (Dani y Sara, 2026-10-20): the bowl of the batch, Monday lunch with
 * leftovers Tuesday to Thursday, for a household of 2 whose weekly template
 * says 2 at every meal. The generator put «servings: 2» on every slot (shown
 * as «Solo hoy: 2») and the list bought for one day (2 rations) instead of 8.
 */
describe('a batch with leftovers counts every meal it covers (PRO-298)', () => {
  it('generation: template diners on every slot + planner leftovers → Monday cooks 8, the list buys 8', async () => {
    const { mergeWithGenerator } = await import('../services/menuPlanner.js')
    const generator: DayMenu[] = Array.from({ length: 7 }, (_, i) => ({
      lunch: { servings: 2, dishes: [{ kind: 'recipe', recipeId: `g${i}`, recipeName: `g${i}`, course: 'main' }] },
    }))
    const slot = (dayIndex: number, leftover: boolean) => ({
      dayIndex,
      meal: 'lunch' as const,
      recipeId: 'bowl',
      recipeName: 'Protein bowl',
      why: '',
      leftoverOf: leftover ? { day: 0, meal: 'lunch' as const } : null,
      problems: [] as string[],
    })
    const { days } = mergeWithGenerator(generator, { slots: [slot(0, false), slot(1, true), slot(2, true), slot(3, true)] } as never)
    expect(days[0].lunch!.servings).toBe(2)
    expect(dinersFor(days, 2, 'bowl')).toBe(8)
    expect(batchServings(days, 0, 'lunch', 2)).toBe(8)
    expect(batchServings(days, 1, 'lunch', 2)).toBe(2)
  })

  it('list: Monday «Solo hoy: 2» (household of 2) + three leftovers → 8', () => {
    const days: DayMenu[] = [
      { lunch: cooked('bowl', 2) },
      { lunch: leftover('bowl', { day: 0, meal: 'lunch' }) },
      { lunch: leftover('bowl', { day: 0, meal: 'lunch' }) },
      { lunch: leftover('bowl', { day: 0, meal: 'lunch' }) },
    ]
    expect(dinersFor(days, 2, 'bowl')).toBe(8)
    expect(batchServings(days, 0, 'lunch', 2)).toBe(8)
  })

  it('«Solo hoy: 1» (one eats on Monday) + a leftover for the household of 2 → 3', () => {
    const days: DayMenu[] = [{ dinner: cooked('lasana', 1) }, { lunch: leftover('lasana', { day: 0, meal: 'dinner' }) }]
    expect(dinersFor(days, 2)).toBe(3)
    expect(batchServings(days, 0, 'dinner', 2)).toBe(3)
  })

  it('«Solo hoy» above the household pays for tápers, but never less than everyone eating every meal', () => {
    // Household of 2, Monday «Solo hoy: 3» (a guest) + three days of leftovers: max(3, 2 + 6) = 8.
    const days: DayMenu[] = [
      { lunch: cooked('bowl', 3) },
      { lunch: leftover('bowl', { day: 0, meal: 'lunch' }) },
      { lunch: leftover('bowl', { day: 0, meal: 'lunch' }) },
      { lunch: leftover('bowl', { day: 0, meal: 'lunch' }) },
    ]
    expect(dinersFor(days, 2, 'bowl')).toBe(8)
    expect(batchServings(days, 0, 'lunch', 2)).toBe(8)
    // Household of 2, «Solo hoy: 6» for a batch + one leftover: 6 covers it.
    const big: DayMenu[] = [{ dinner: cooked('lasana', 6) }, { lunch: leftover('lasana', { day: 0, meal: 'dinner' }) }]
    expect(dinersFor(big, 2)).toBe(6)
    expect(batchServings(big, 0, 'dinner', 2)).toBe(6)
  })
})
