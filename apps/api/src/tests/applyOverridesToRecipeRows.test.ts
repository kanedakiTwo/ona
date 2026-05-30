/**
 * Pure-logic tests for `applyOverridesToRecipeRows` — the shopping list
 * aggregator's hook into per-household ingredient overrides. Exercising it
 * here keeps the override math testable without spinning up a DB; the
 * downstream scaling / unit folding / rounding has its own coverage.
 */
import { describe, expect, it } from 'vitest'
import type { IngredientOverride, Unit } from '@ona/shared'
import { applyOverridesToRecipeRows } from '../services/shoppingList.js'

interface Row {
  recipeIngredientId: string | null
  ingredientId: string
  quantity: number
  unit: Unit
  ingredientName: string
}

const ROW_A: Row = {
  recipeIngredientId: 'a1',
  ingredientId: 'cebolla',
  quantity: 100,
  unit: 'g',
  ingredientName: 'cebolla',
}
const ROW_B: Row = {
  recipeIngredientId: 'a2',
  ingredientId: 'tomate',
  quantity: 200,
  unit: 'g',
  ingredientName: 'tomate',
}

function noopResolver(): Row | null {
  return null
}

describe('applyOverridesToRecipeRows', () => {
  it('returns rows unchanged when overrides is empty', () => {
    const out = applyOverridesToRecipeRows([ROW_A, ROW_B], [], noopResolver)
    expect(out).toEqual([ROW_A, ROW_B])
  })

  it('drops a removed row by recipeIngredientId', () => {
    const overrides: IngredientOverride[] = [
      { kind: 'remove', recipeIngredientId: 'a1' },
    ]
    const out = applyOverridesToRecipeRows([ROW_A, ROW_B], overrides, noopResolver)
    expect(out).toEqual([ROW_B])
  })

  it('applies a quantity-only modify (unit preserved)', () => {
    const overrides: IngredientOverride[] = [
      { kind: 'modify', recipeIngredientId: 'a1', quantity: 250 },
    ]
    const out = applyOverridesToRecipeRows([ROW_A, ROW_B], overrides, noopResolver)
    expect(out[0]).toMatchObject({ recipeIngredientId: 'a1', quantity: 250, unit: 'g' })
    expect(out[1]).toEqual(ROW_B)
  })

  it('applies both quantity and unit on a modify', () => {
    const overrides: IngredientOverride[] = [
      { kind: 'modify', recipeIngredientId: 'a1', quantity: 1, unit: 'u' },
    ]
    const out = applyOverridesToRecipeRows([ROW_A, ROW_B], overrides, noopResolver)
    expect(out[0]).toMatchObject({ quantity: 1, unit: 'u' })
  })

  it('remove wins over a modify on the same target regardless of order', () => {
    const overrides: IngredientOverride[] = [
      { kind: 'modify', recipeIngredientId: 'a1', quantity: 9999 },
      { kind: 'remove', recipeIngredientId: 'a1' },
    ]
    const out = applyOverridesToRecipeRows([ROW_A, ROW_B], overrides, noopResolver)
    expect(out).toEqual([ROW_B])
  })

  it('also drops modify when remove appears before modify (defensive)', () => {
    const overrides: IngredientOverride[] = [
      { kind: 'remove', recipeIngredientId: 'a1' },
      { kind: 'modify', recipeIngredientId: 'a1', quantity: 9999 },
    ]
    const out = applyOverridesToRecipeRows([ROW_A, ROW_B], overrides, noopResolver)
    expect(out).toEqual([ROW_B])
  })

  it('appends rows for adds that the resolver can resolve', () => {
    const overrides: IngredientOverride[] = [
      { kind: 'add', label: 'puerro', quantity: 1, unit: 'u' },
    ]
    const resolver = (add: Extract<IngredientOverride, { kind: 'add' }>): Row | null => ({
      recipeIngredientId: null,
      ingredientId: 'puerro',
      quantity: add.quantity ?? 0,
      unit: add.unit ?? 'g',
      ingredientName: add.label,
    })
    const out = applyOverridesToRecipeRows([ROW_A], overrides, resolver)
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ ingredientId: 'puerro', quantity: 1, unit: 'u' })
  })

  it('drops adds when the resolver returns null', () => {
    const overrides: IngredientOverride[] = [
      { kind: 'add', label: 'algo raro', quantity: 1, unit: 'u' },
    ]
    const out = applyOverridesToRecipeRows([ROW_A], overrides, noopResolver)
    expect(out).toEqual([ROW_A])
  })

  it('preserves original row order before appending resolved adds', () => {
    const overrides: IngredientOverride[] = [
      { kind: 'add', label: 'sal', quantity: 5, unit: 'g' },
      { kind: 'remove', recipeIngredientId: 'a1' },
    ]
    const resolver = (add: Extract<IngredientOverride, { kind: 'add' }>): Row | null => ({
      recipeIngredientId: null,
      ingredientId: 'sal',
      quantity: add.quantity ?? 0,
      unit: add.unit ?? 'g',
      ingredientName: add.label,
    })
    const out = applyOverridesToRecipeRows([ROW_A, ROW_B], overrides, resolver)
    // ROW_A removed, ROW_B preserved, sal appended at the end
    expect(out.map((r) => r.ingredientId)).toEqual(['tomate', 'sal'])
  })

  it('skips rows with null recipeIngredientId for remove targeting', () => {
    // Synthetic rows from earlier adds shouldn't be removed by accident if a
    // later remove uses a stray uuid string.
    const synthetic: Row = { ...ROW_A, recipeIngredientId: null }
    const overrides: IngredientOverride[] = [
      { kind: 'remove', recipeIngredientId: 'a1' },
    ]
    const out = applyOverridesToRecipeRows([synthetic, ROW_B], overrides, noopResolver)
    expect(out).toEqual([synthetic, ROW_B])
  })
})
