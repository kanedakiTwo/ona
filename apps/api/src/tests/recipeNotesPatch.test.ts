/**
 * Pure-logic tests for `applyNotesPatch` — the reducer that merges a partial
 * `{ notes?, rating?, substitutions? }` patch onto an existing notes row
 * (or onto `null` if no row exists yet). Kept pure so a rating-clamp or
 * partial-update regression trips a unit failure instead of a silent UX bug.
 */
import { describe, expect, it } from 'vitest'
import {
  applyNotesPatch,
  sanitizeIngredientOverrides,
  validateRating,
  type NotesPatch,
  type NotesShape,
} from '../services/recipeNotesStore.js'

const empty: NotesShape = {
  notes: null,
  rating: null,
  substitutions: null,
  customTags: [],
  ingredientOverrides: [],
}

describe('validateRating', () => {
  it('accepts integers 1..5', () => {
    for (const r of [1, 2, 3, 4, 5]) {
      expect(validateRating(r)).toEqual({ ok: true, value: r })
    }
  })
  it('accepts null and undefined (clear)', () => {
    expect(validateRating(null)).toEqual({ ok: true, value: null })
    expect(validateRating(undefined)).toEqual({ ok: true, value: null })
  })
  it('rejects out-of-range and non-integer', () => {
    expect(validateRating(0).ok).toBe(false)
    expect(validateRating(6).ok).toBe(false)
    expect(validateRating(3.5).ok).toBe(false)
    expect(validateRating('three' as any).ok).toBe(false)
  })
})

describe('applyNotesPatch', () => {
  it('on empty starting state, undefined fields stay null', () => {
    const result = applyNotesPatch(empty, {})
    expect(result).toEqual({
      notes: null,
      rating: null,
      substitutions: null,
      customTags: [],
      ingredientOverrides: [],
    })
  })

  it('sets each field independently', () => {
    expect(applyNotesPatch(empty, { rating: 4 })).toEqual({
      notes: null,
      rating: 4,
      substitutions: null,
      customTags: [],
      ingredientOverrides: [],
    })
    expect(applyNotesPatch(empty, { notes: 'Está rico' })).toEqual({
      notes: 'Está rico',
      rating: null,
      substitutions: null,
      customTags: [],
      ingredientOverrides: [],
    })
  })

  it('preserves fields not mentioned in the patch', () => {
    const current: NotesShape = {
      notes: 'X',
      rating: 3,
      substitutions: 'sin cebolla',
      customTags: ['vegano'],
      ingredientOverrides: [],
    }
    const result = applyNotesPatch(current, { rating: 5 })
    expect(result).toEqual({
      notes: 'X',
      rating: 5,
      substitutions: 'sin cebolla',
      customTags: ['vegano'],
      ingredientOverrides: [],
    })
  })

  it('explicit null clears a field while preserving others', () => {
    const current: NotesShape = {
      notes: 'X',
      rating: 3,
      substitutions: 'sin cebolla',
      customTags: [],
      ingredientOverrides: [],
    }
    const result = applyNotesPatch(current, { rating: null })
    expect(result).toEqual({
      notes: 'X',
      rating: null,
      substitutions: 'sin cebolla',
      customTags: [],
      ingredientOverrides: [],
    })
  })

  it('trims string fields and treats empty strings as null', () => {
    const current: NotesShape = {
      notes: 'old',
      rating: 4,
      substitutions: null,
      customTags: [],
      ingredientOverrides: [],
    }
    expect(applyNotesPatch(current, { notes: '   ' })).toEqual({
      notes: null,
      rating: 4,
      substitutions: null,
      customTags: [],
      ingredientOverrides: [],
    })
    expect(applyNotesPatch(current, { notes: '  fresh take  ' })).toEqual({
      notes: 'fresh take',
      rating: 4,
      substitutions: null,
      customTags: [],
      ingredientOverrides: [],
    })
  })

  it('caps note + substitutions length at 1000 chars (silently truncates)', () => {
    const big = 'x'.repeat(1500)
    const result = applyNotesPatch(empty, { notes: big, substitutions: big })
    expect(result.notes?.length).toBe(1000)
    expect(result.substitutions?.length).toBe(1000)
  })

  it('routes ingredientOverrides through the sanitizer when patched', () => {
    const result = applyNotesPatch(empty, {
      ingredientOverrides: [
        { kind: 'remove', recipeIngredientId: '00000000-0000-0000-0000-000000000001' },
        { kind: 'add', label: 'Algo nuevo', quantity: 2, unit: 'g' },
        { kind: 'lol' } as any, // invalid → dropped
      ],
    })
    expect(result.ingredientOverrides).toHaveLength(2)
    expect(result.ingredientOverrides[0].kind).toBe('remove')
    expect(result.ingredientOverrides[1].kind).toBe('add')
  })

  it('preserves ingredientOverrides when not patched', () => {
    const current: NotesShape = {
      notes: 'X',
      rating: 4,
      substitutions: null,
      customTags: [],
      ingredientOverrides: [
        { kind: 'remove', recipeIngredientId: '00000000-0000-0000-0000-000000000001' },
      ],
    }
    const result = applyNotesPatch(current, { rating: 5 })
    expect(result.ingredientOverrides).toEqual(current.ingredientOverrides)
  })
})

describe('sanitizeIngredientOverrides', () => {
  const targetA = '00000000-0000-0000-0000-000000000001'
  const targetB = '00000000-0000-0000-0000-000000000002'

  it('drops non-array input', () => {
    expect(sanitizeIngredientOverrides(null)).toEqual([])
    expect(sanitizeIngredientOverrides('lol')).toEqual([])
    expect(sanitizeIngredientOverrides({})).toEqual([])
  })

  it('drops invalid entries silently', () => {
    const out = sanitizeIngredientOverrides([
      { kind: 'remove', recipeIngredientId: targetA },
      { kind: 'remove' }, // missing target → invalid
      { kind: 'whatever', recipeIngredientId: targetA }, // unknown kind
      { kind: 'add', label: '' }, // empty label fails min(1)
      { kind: 'add', label: 'OK' },
    ])
    expect(out).toHaveLength(2)
    expect(out[0].kind).toBe('remove')
    expect(out[1].kind).toBe('add')
  })

  it('last-write-wins per target for remove and modify', () => {
    const out = sanitizeIngredientOverrides([
      { kind: 'modify', recipeIngredientId: targetA, quantity: 100, unit: 'g' },
      { kind: 'modify', recipeIngredientId: targetA, quantity: 200, unit: 'g' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'modify', quantity: 200 })
  })

  it('remove on a target wipes any prior modify on the same target', () => {
    const out = sanitizeIngredientOverrides([
      { kind: 'modify', recipeIngredientId: targetA, quantity: 100, unit: 'g' },
      { kind: 'remove', recipeIngredientId: targetA },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('remove')
  })

  it('keeps adds independent (no dedup)', () => {
    const out = sanitizeIngredientOverrides([
      { kind: 'add', label: 'sal', quantity: 5, unit: 'g' },
      { kind: 'add', label: 'sal', quantity: 5, unit: 'g' },
    ])
    expect(out).toHaveLength(2)
  })

  it('caps the array at 50', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      kind: 'add' as const,
      label: `extra-${i}`,
    }))
    expect(sanitizeIngredientOverrides(many)).toHaveLength(50)
  })

  it('keeps removes and modifies on different targets', () => {
    const out = sanitizeIngredientOverrides([
      { kind: 'remove', recipeIngredientId: targetA },
      { kind: 'modify', recipeIngredientId: targetB, quantity: 50, unit: 'g' },
    ])
    expect(out).toHaveLength(2)
  })
})
