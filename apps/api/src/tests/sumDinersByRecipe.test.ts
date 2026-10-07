import { describe, expect, it } from 'vitest'
import { sumDinersByRecipe } from '../services/shoppingList.js'
import type { DayMenu, MealSlot } from '@ona/shared'

const slot = (recipeId: string, servings?: number): MealSlot =>
  servings == null
    ? { dishes: [{ kind: 'recipe', recipeId }] }
    : { servings, dishes: [{ kind: 'recipe', recipeId }] }

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

  it('slot with only note dishes contributes 0 items', () => {
    const days: DayMenu[] = [
      { lunch: { dishes: [{ kind: 'note', text: 'comer fuera' }] } },
    ]
    expect(sumDinersByRecipe(days, 4).size).toBe(0)
  })

  it('slot with a recipe dish and a note dish — only the recipe contributes', () => {
    const days: DayMenu[] = [
      {
        lunch: {
          servings: 3,
          dishes: [
            { kind: 'recipe', recipeId: 'r1', recipeName: 'Cocido' },
            { kind: 'note', text: 'con pan' },
          ],
        },
      },
    ]
    expect(sumDinersByRecipe(days, 4).get('r1')).toBe(3)
    expect(sumDinersByRecipe(days, 4).size).toBe(1)
  })
})

describe('sumDinersByRecipe — "siempre la cocino para al menos N" (recipe_notes.min_servings)', () => {
  const slot = (recipeId: string, extra: Record<string, unknown> = {}) => ({
    dishes: [{ kind: 'recipe', recipeId, recipeName: recipeId, ...extra }],
  })

  it('2 people, lentejas always for 6 → buy for 6', () => {
    const days = [{ lunch: slot('lentejas') }] as any
    expect(sumDinersByRecipe(days, 2, new Map([['lentejas', 6]])).get('lentejas')).toBe(6)
  })

  it('cooked twice in the week → at least 6 each time', () => {
    const days = [{ lunch: slot('lentejas') }, {}, { dinner: slot('lentejas') }] as any
    expect(sumDinersByRecipe(days, 2, new Map([['lentejas', 6]])).get('lentejas')).toBe(12)
  })

  it('a planned leftover is part of the same batch, not another cooking', () => {
    const days = [{ lunch: slot('lentejas') }, { dinner: slot('lentejas', { variant: 'leftover' }) }] as any
    // 2 + 2 diners from one batch, minimum 6 → still 6
    expect(sumDinersByRecipe(days, 2, new Map([['lentejas', 6]])).get('lentejas')).toBe(6)
  })

  it('never lowers what the diners already need, and leaves other recipes alone', () => {
    const days = [{ lunch: { servings: 8, ...slot('lentejas') }, dinner: slot('crema') }] as any
    const out = sumDinersByRecipe(days, 2, new Map([['lentejas', 6]]))
    expect(out.get('lentejas')).toBe(8)
    expect(out.get('crema')).toBe(2)
  })
})
