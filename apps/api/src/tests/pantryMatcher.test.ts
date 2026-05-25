/**
 * Pure-logic tests for `scoreRecipeAgainstPantry` (PR 12 — cook from
 * pantry). Coverage is `matched / required`. Optional recipe ingredients
 * don't pull the score down. Unit mismatch + quantity comparison are
 * deferred (v1 only checks "do we have any at all?").
 */
import { describe, expect, it } from 'vitest'
import {
  scoreRecipeAgainstPantry,
  type PantrySet,
  type RecipeIngredientSnapshot,
} from '../services/pantryMatcher.js'

function ing(
  id: string,
  optional = false,
  name: string = id,
): RecipeIngredientSnapshot {
  return { ingredientId: id, ingredientName: name, optional }
}

describe('scoreRecipeAgainstPantry', () => {
  it('returns 1.0 when every required ingredient is in the pantry', () => {
    const pantry: PantrySet = new Set(['a', 'b'])
    const r = scoreRecipeAgainstPantry([ing('a'), ing('b')], pantry)
    expect(r.coverage).toBe(1)
    expect(r.matchedCount).toBe(2)
    expect(r.totalRequired).toBe(2)
    expect(r.missing).toEqual([])
  })

  it('returns 0 when nothing is in the pantry', () => {
    const r = scoreRecipeAgainstPantry([ing('a'), ing('b')], new Set())
    expect(r.coverage).toBe(0)
    expect(r.matchedCount).toBe(0)
    expect(r.missing).toEqual(['a', 'b'])
  })

  it('returns 0.5 when half the required ingredients are in the pantry', () => {
    const r = scoreRecipeAgainstPantry(
      [ing('a'), ing('b'), ing('c'), ing('d')],
      new Set(['a', 'b']),
    )
    expect(r.coverage).toBe(0.5)
    expect(r.matchedCount).toBe(2)
    expect(r.totalRequired).toBe(4)
    expect(r.missing.sort()).toEqual(['c', 'd'])
  })

  it('optional ingredients do not pull the score down', () => {
    // 1 required + 2 optional — required is covered, optional are not.
    // Score should still be 1.0 (you can cook the recipe without optionals).
    const r = scoreRecipeAgainstPantry(
      [ing('a'), ing('b', true), ing('c', true)],
      new Set(['a']),
    )
    expect(r.coverage).toBe(1)
    expect(r.matchedCount).toBe(1)
    expect(r.totalRequired).toBe(1)
    expect(r.missing).toEqual([])
  })

  it('handles edge case of an all-optional recipe (total = 0)', () => {
    // Defensive: a recipe with only optional ingredients (rare but possible).
    // Score is 0 — there's nothing required to match, but we don't want to
    // surface it as a perfect "1.0 match" because it has no anchor.
    const r = scoreRecipeAgainstPantry([ing('a', true)], new Set())
    expect(r.coverage).toBe(0)
    expect(r.totalRequired).toBe(0)
  })

  it('returns the human names of missing ingredients (not the ids)', () => {
    const r = scoreRecipeAgainstPantry(
      [ing('a', false, 'arroz'), ing('b', false, 'azafrán'), ing('c', false, 'cebolla')],
      new Set(['a']),
    )
    expect(r.missing.sort()).toEqual(['azafrán', 'cebolla'])
  })
})
