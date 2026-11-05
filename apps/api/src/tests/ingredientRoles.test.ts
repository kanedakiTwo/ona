import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { carryIngredientMarks, ingredientMarksOf } from '../services/ingredientRoles.js'

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

describe('both copy paths carry the marks', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
  it.each(['routes/recipes.ts', 'services/assistant/skills.ts'])('%s spreads ingredientMarksOf into the copied rows', (file) => {
    expect(src(file)).toMatch(/\.\.\.ingredientMarksOf\(ing\)/)
  })
})
