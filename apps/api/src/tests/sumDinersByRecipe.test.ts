import { describe, expect, it } from 'vitest'
import { sumDinersByRecipe } from '../services/shoppingList.js'
import type { DayMenu } from '@ona/shared'

const slot = (recipeId: string, servings?: number) =>
  servings == null ? { recipeId } : { recipeId, servings }

describe('sumDinersByRecipe', () => {
  it('falls back to the household multiplier when no slot has an override', () => {
    const days: DayMenu[] = [
      { lunch: slot('a'), dinner: slot('b') },
      { lunch: slot('a') }, // a appears twice
    ]
    const out = sumDinersByRecipe(days, 4)
    expect(out.get('a')).toBe(8) // 4 + 4
    expect(out.get('b')).toBe(4)
  })

  it('lets per-slot `servings` override the fallback for that occurrence only', () => {
    // The user said "Saturday dinner is for 8, the rest of the week is for 4".
    const days: DayMenu[] = [
      { dinner: slot('paella') },       // 4 diners (fallback)
      { dinner: slot('paella', 8) },    // 8 diners (override)
    ]
    expect(sumDinersByRecipe(days, 4).get('paella')).toBe(12)
  })

  it('ignores invalid override values (≤0, NaN) and uses the fallback', () => {
    const days: DayMenu[] = [
      { lunch: slot('x', 0) },
      { lunch: slot('x', -2) },
    ]
    expect(sumDinersByRecipe(days, 3).get('x')).toBe(6) // both fall back to 3
  })

  it('skips empty slots', () => {
    const days: DayMenu[] = [
      { lunch: undefined as never },
      { dinner: slot('y') },
    ]
    expect(sumDinersByRecipe(days, 2).get('y')).toBe(2)
    expect(sumDinersByRecipe(days, 2).size).toBe(1)
  })

  it('produces an empty map when no slots are filled', () => {
    expect(sumDinersByRecipe([], 4).size).toBe(0)
    expect(sumDinersByRecipe([{}, {}, {}], 4).size).toBe(0)
  })
})
