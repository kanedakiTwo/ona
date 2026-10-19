/**
 * PRO-240 · tápers on the menu (Dani y Sara, Laura, 2026-10-18):
 * (1) every dish shows its name, also those saved without one (Mimo's
 *     tápers, the recipes Mimo creates) — filled from the recipe on read;
 * (2) «Táper de la nevera» (`variant: 'fridge'`) besides «Del congelador»;
 * (3) turning cooked food into tápers doesn't ask for its ingredients again,
 *     not even for the leftovers that came out of the same batch.
 */
import { describe, expect, it } from 'vitest'
import type { DayMenu } from '@ona/shared'
import { isTaperDish } from '@ona/shared'
import { recipeIdsWithoutName, withRecipeNames } from '../services/menuNames.js'
import { sumDinersByRecipe, withLeftoverBatches } from '../services/shoppingList.js'
import { dishLabel } from '../services/menuText.js'
import { buildWeekImageModel } from '../services/weekImage/model.js'

const empty = (): DayMenu[] => Array.from({ length: 7 }, () => ({}))

describe('(1) dish names', () => {
  const days: DayMenu[] = empty()
  days[0] = { lunch: { dishes: [{ kind: 'recipe', recipeId: 'r-len', variant: 'freezer' }] } }
  days[2] = {
    dinner: {
      dishes: [
        { kind: 'recipe', recipeId: 'r-esp', recipeName: 'Espinacas' },
        { kind: 'recipe', recipeId: 'r-huevo', recipeName: '  ' },
      ],
    },
  }

  it('finds the nameless recipe dishes', () => {
    expect(recipeIdsWithoutName(days).sort()).toEqual(['r-huevo', 'r-len'])
  })

  it('names them from the recipes, leaves the named ones and never mutates', () => {
    const named = withRecipeNames(days, new Map([['r-len', 'Lentejas estofadas'], ['r-huevo', 'Huevo duro']]))
    expect(named[0].lunch!.dishes[0]).toMatchObject({ recipeName: 'Lentejas estofadas', variant: 'freezer' })
    expect(named[2].dinner!.dishes.map((d) => (d.kind === 'recipe' ? d.recipeName : null))).toEqual(['Espinacas', 'Huevo duro'])
    expect((days[0].lunch!.dishes[0] as { recipeName?: string }).recipeName).toBeUndefined()
  })
})

describe('(2) «Táper de la nevera»', () => {
  it('is a táper like the freezer one', () => {
    expect(isTaperDish({ kind: 'recipe', recipeId: 'x', variant: 'fridge' })).toBe(true)
    expect(isTaperDish({ kind: 'recipe', recipeId: 'x', variant: 'freezer' })).toBe(true)
    expect(isTaperDish({ kind: 'recipe', recipeId: 'x', variant: 'leftover' })).toBe(false)
    expect(isTaperDish({ kind: 'note', text: 'Táper' })).toBe(false)
  })

  it('reads «(táper de la nevera)» on WhatsApp, text and picture', () => {
    expect(dishLabel({ kind: 'recipe', recipeId: 'x', recipeName: 'Crema de zanahoria', variant: 'fridge' })).toBe('Crema de zanahoria (táper de la nevera)')
    const days = empty()
    days[3] = { dinner: { dishes: [{ kind: 'recipe', recipeId: 'x', recipeName: 'Albóndigas', variant: 'fridge' }] } }
    const m = buildWeekImageModel({ weekStart: '2026-10-19', days }, { today: '2026-10-19' })!
    expect(m.rows.find((r) => r.dayIndex === 3)!.cells[0].dishes[0].name).toBe('Albóndigas (táper de la nevera)')
  })
})

describe('(3) the list after the tápers', () => {
  // Batch on Sunday: lentejas Mon (source) + Tue (leftovers), ternera Wed + Thu.
  const planned = (): DayMenu[] => {
    const d = empty()
    d[0] = { lunch: { dishes: [{ kind: 'recipe', recipeId: 'len', recipeName: 'Lentejas' }] } }
    d[1] = { lunch: { dishes: [{ kind: 'recipe', recipeId: 'len', recipeName: 'Lentejas', variant: 'leftover', leftoverOf: { day: 0, meal: 'lunch', dishPosition: 0 } }] } }
    d[2] = { lunch: { dishes: [{ kind: 'recipe', recipeId: 'ter', recipeName: 'Ternera' }] } }
    d[3] = { lunch: { dishes: [{ kind: 'recipe', recipeId: 'ter', recipeName: 'Ternera', variant: 'leftover', leftoverOf: { day: 2, meal: 'lunch', dishPosition: 0 } }] } }
    return d
  }

  it('before: both cookings and their leftovers add to the list', () => {
    const sums = sumDinersByRecipe(withLeftoverBatches(planned()), 2)
    expect(sums.get('len')).toBe(4)
    expect(sums.get('ter')).toBe(4)
  })

  it('after Mimo turns the sources into tápers (fridge or freezer), nothing is asked again — leftovers included', () => {
    const d = planned()
    d[0] = { lunch: { dishes: [{ kind: 'recipe', recipeId: 'len', variant: 'fridge' }] } }
    d[2] = { lunch: { dishes: [{ kind: 'recipe', recipeId: 'ter', variant: 'freezer' }] } }
    const sums = sumDinersByRecipe(withLeftoverBatches(d), 2)
    expect(sums.get('len')).toBeUndefined()
    expect(sums.get('ter')).toBeUndefined()
  })

  it('a leftover of a different recipe than the táper still counts', () => {
    const d = planned()
    d[0] = { lunch: { dishes: [{ kind: 'recipe', recipeId: 'otra', variant: 'fridge' }] } }
    expect(sumDinersByRecipe(withLeftoverBatches(d), 2).get('len')).toBe(2)
  })
})
