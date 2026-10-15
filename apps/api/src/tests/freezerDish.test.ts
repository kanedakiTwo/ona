/**
 * PRO-82: a táper from the freezer (`variant: 'freezer'`, «Del congelador»)
 * is linked to its recipe but never adds to the shopping list, whatever week
 * the original was cooked in. Notes keep their behaviour (they add nothing).
 */
import { describe, expect, it } from 'vitest'
import type { DayMenu } from '@ona/shared'
import { sumDinersByRecipe } from '../services/shoppingList.js'
import { mealLinesForDay } from '../services/menuText.js'

describe('shopping aggregator — freezer tápers (PRO-82)', () => {
  it('a freezer dish adds no ingredients even though its recipe is nowhere else in the week', () => {
    const days: DayMenu[] = [
      { dinner: { dishes: [{ kind: 'recipe', recipeId: 'lentejas', recipeName: 'Lentejas', variant: 'freezer' }] } },
      { lunch: { dishes: [{ kind: 'recipe', recipeId: 'crema', recipeName: 'Crema' }] } },
    ]
    const out = sumDinersByRecipe(days, 2)
    expect(out.has('lentejas')).toBe(false)
    expect(out.get('crema')).toBe(2)
  })

  it('cooked this week AND eaten from the freezer → only the cooking counts, and not as a cooking for «al menos N»', () => {
    const days: DayMenu[] = [
      { lunch: { dishes: [{ kind: 'recipe', recipeId: 'lentejas' }] } },
      { dinner: { servings: 4, dishes: [{ kind: 'recipe', recipeId: 'lentejas', variant: 'freezer' }] } },
    ]
    expect(sumDinersByRecipe(days, 2).get('lentejas')).toBe(2)
    // minimum 6 per cooking, one cooking (the táper is not one) → 6, not 12
    expect(sumDinersByRecipe(days, 2, new Map([['lentejas', 6]])).get('lentejas')).toBe(6)
  })

  it('a note still adds nothing', () => {
    const days: DayMenu[] = [{ dinner: { dishes: [{ kind: 'note', text: 'Táper: cocido' }] } }]
    expect(sumDinersByRecipe(days, 2).size).toBe(0)
  })

  it("Mimo's menu text marks it «del congelador»", () => {
    const day: DayMenu = { dinner: { dishes: [{ kind: 'recipe', recipeId: 'l', recipeName: 'Lentejas', variant: 'freezer' }] } }
    expect(mealLinesForDay(day).join('\n')).toContain('Lentejas (del congelador)')
  })
})
