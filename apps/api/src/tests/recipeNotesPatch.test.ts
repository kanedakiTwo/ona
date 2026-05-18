/**
 * Pure-logic tests for `applyNotesPatch` — the reducer that merges a partial
 * `{ notes?, rating?, substitutions? }` patch onto an existing notes row
 * (or onto `null` if no row exists yet). Kept pure so a rating-clamp or
 * partial-update regression trips a unit failure instead of a silent UX bug.
 */
import { describe, expect, it } from 'vitest'
import {
  applyNotesPatch,
  validateRating,
  type NotesPatch,
  type NotesShape,
} from '../services/recipeNotesStore.js'

const empty: NotesShape = { notes: null, rating: null, substitutions: null }

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
    expect(result).toEqual({ notes: null, rating: null, substitutions: null })
  })

  it('sets each field independently', () => {
    expect(applyNotesPatch(empty, { rating: 4 })).toEqual({
      notes: null,
      rating: 4,
      substitutions: null,
    })
    expect(applyNotesPatch(empty, { notes: 'Está rico' })).toEqual({
      notes: 'Está rico',
      rating: null,
      substitutions: null,
    })
  })

  it('preserves fields not mentioned in the patch', () => {
    const current: NotesShape = { notes: 'X', rating: 3, substitutions: 'sin cebolla' }
    const result = applyNotesPatch(current, { rating: 5 })
    expect(result).toEqual({ notes: 'X', rating: 5, substitutions: 'sin cebolla' })
  })

  it('explicit null clears a field while preserving others', () => {
    const current: NotesShape = { notes: 'X', rating: 3, substitutions: 'sin cebolla' }
    const result = applyNotesPatch(current, { rating: null })
    expect(result).toEqual({ notes: 'X', rating: null, substitutions: 'sin cebolla' })
  })

  it('trims string fields and treats empty strings as null', () => {
    const current: NotesShape = { notes: 'old', rating: 4, substitutions: null }
    expect(applyNotesPatch(current, { notes: '   ' })).toEqual({
      notes: null,
      rating: 4,
      substitutions: null,
    })
    expect(applyNotesPatch(current, { notes: '  fresh take  ' })).toEqual({
      notes: 'fresh take',
      rating: 4,
      substitutions: null,
    })
  })

  it('caps note + substitutions length at 1000 chars (silently truncates)', () => {
    const big = 'x'.repeat(1500)
    const result = applyNotesPatch(empty, { notes: big, substitutions: big })
    expect(result.notes?.length).toBe(1000)
    expect(result.substitutions?.length).toBe(1000)
  })
})
