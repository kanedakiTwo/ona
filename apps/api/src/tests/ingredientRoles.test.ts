import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  autoIngredientRole,
  carryIngredientMarks,
  ingredientMarksOf,
  recipeGrams,
  roleOf,
  type RoleLine,
} from '../services/ingredientRoles.js'

const prev = (id: string, ingredientId: string, role: 'essential' | 'secondary' | null, subs: string[] = []) => ({
  id,
  ingredientId,
  role,
  substituteIngredientIds: subs,
})

describe('carryIngredientMarks', () => {
  it('keeps the marks of a row that comes back with the same id', () => {
    const out = carryIngredientMarks([prev('r1', 'pollo', 'essential', ['pavo'])], [{ id: 'r1', ingredientId: 'pollo' }])
    expect(out).toEqual([{ role: 'essential', substituteIngredientIds: ['pavo'] }])
  })

  it('falls back to the ingredient id when the row id is new', () => {
    const out = carryIngredientMarks([prev('r1', 'perejil', 'secondary')], [{ id: 'nuevo', ingredientId: 'perejil' }])
    expect(out[0].role).toBe('secondary')
  })

  it('a new ingredient comes unmarked', () => {
    const out = carryIngredientMarks([prev('r1', 'pollo', 'essential')], [{ id: 'r2', ingredientId: 'nata' }])
    expect(out).toEqual([{ role: null, substituteIngredientIds: [] }])
  })

  it('the same ingredient twice (two sections) keeps each row its own marks', () => {
    const out = carryIngredientMarks(
      [prev('masa', 'harina', 'essential'), prev('rebozado', 'harina', 'secondary')],
      [
        { id: 'rebozado', ingredientId: 'harina' },
        { id: 'masa', ingredientId: 'harina' },
      ],
    )
    expect(out.map((o) => o.role)).toEqual(['secondary', 'essential'])
  })

  it('a row id reused for another ingredient does not carry the old marks', () => {
    const out = carryIngredientMarks([prev('r1', 'pollo', 'essential')], [{ id: 'r1', ingredientId: 'tofu' }])
    expect(out[0].role).toBeNull()
  })
})

describe('ingredientMarksOf', () => {
  it('copies role and substitutes, defaulting to unmarked', () => {
    expect(ingredientMarksOf({ role: 'secondary', substituteIngredientIds: ['a'] })).toEqual({ role: 'secondary', substituteIngredientIds: ['a'] })
    expect(ingredientMarksOf({})).toEqual({ role: null, substituteIngredientIds: [] })
  })
})

const line = (over: Partial<RoleLine>): RoleLine => ({ ingredientName: 'x', quantity: 100, unit: 'g', ...over })

describe('autoIngredientRole', () => {
  const total = 1000
  it('protein, cereal and legume are essential whatever they weigh', () => {
    expect(autoIngredientRole(line({ category: 'proteina', quantity: 50 }), total)).toBe('essential')
    expect(autoIngredientRole(line({ category: 'Cereal', quantity: 10 }), total)).toBe('essential')
    expect(autoIngredientRole(line({ category: 'legumbre', quantity: 10 }), total)).toBe('essential')
  })
  it('15 % of the recipe weight or more is essential; less is secondary', () => {
    expect(autoIngredientRole(line({ quantity: 150 }), total)).toBe('essential')
    expect(autoIngredientRole(line({ quantity: 149 }), total)).toBe('secondary')
  })
  it('units with a weight count in grams', () => {
    expect(autoIngredientRole(line({ quantity: 2, unit: 'u', unitWeight: 200 }), total)).toBe('essential')
  })
  it('a line that cannot be weighed is secondary', () => {
    expect(autoIngredientRole(line({ quantity: 1, unit: 'cdita' }), total)).toBe('secondary')
  })
  it('optional, «al gusto», «pizca» and zero quantity are secondary', () => {
    expect(autoIngredientRole(line({ quantity: 500, optional: true }), total)).toBe('secondary')
    expect(autoIngredientRole(line({ quantity: 500, note: 'al gusto' }), total)).toBe('secondary')
    expect(autoIngredientRole(line({ quantity: 500, displayUnit: 'pizca' }), total)).toBe('secondary')
    expect(autoIngredientRole(line({ quantity: 0, category: 'proteina' }), total)).toBe('secondary')
  })
  it('the units al_gusto and pizca are secondary, even for a cereal', () => {
    expect(autoIngredientRole(line({ quantity: 1, unit: 'al_gusto', category: 'cereal' }), total)).toBe('secondary')
    expect(autoIngredientRole(line({ quantity: 1, unit: 'pizca' }), total)).toBe('secondary')
  })
  it('with no category only the weight decides', () => {
    expect(autoIngredientRole(line({ category: null, quantity: 400 }), total)).toBe('essential')
  })
})

describe('recipeGrams', () => {
  it('adds what can be weighed, leaving out basics', () => {
    expect(recipeGrams([line({ quantity: 300 }), line({ ingredientName: 'Sal', quantity: 10 }), line({ quantity: 1, unit: 'cdita' })])).toBe(300)
  })
})

describe('roleOf', () => {
  it('a mark wins over the rule, except an optional line is always secondary', () => {
    expect(roleOf(line({ role: 'essential', quantity: 1 }), 1000)).toBe('essential')
    expect(roleOf(line({ role: 'essential', optional: true }), 1000)).toBe('secondary')
    expect(roleOf(line({ role: null, quantity: 900 }), 1000)).toBe('essential')
  })
})

describe('both copy paths carry the marks', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
  it.each(['routes/recipes.ts', 'services/assistant/skills.ts'])('%s spreads ingredientMarksOf into the copied rows', (file) => {
    expect(src(file)).toMatch(/\.\.\.ingredientMarksOf\(ing\)/)
  })
})
