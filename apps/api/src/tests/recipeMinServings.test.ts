/** recipe_notes.min_servings: what the API stores for "siempre la cocino para al menos N". */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {}, pool: {} }))

import { applyNotesPatch, sanitizeMinServings } from '../services/recipeNotesStore.js'

describe('sanitizeMinServings', () => {
  it('keeps whole servings 1..24, otherwise null', () => {
    expect(sanitizeMinServings(6)).toBe(6)
    expect(sanitizeMinServings(4.4)).toBe(4)
    expect(sanitizeMinServings(0)).toBeNull()
    expect(sanitizeMinServings(25)).toBeNull()
    expect(sanitizeMinServings('6')).toBeNull()
    expect(sanitizeMinServings(null)).toBeNull()
  })
})

describe('applyNotesPatch', () => {
  const base = { notes: null, rating: null, substitutions: null, customTags: [], ingredientOverrides: [], minServings: null }
  it('sets and clears the minimum without touching the rest', () => {
    const set = applyNotesPatch({ ...base, rating: 4 }, { minServings: 6 })
    expect(set).toMatchObject({ minServings: 6, rating: 4 })
    expect(applyNotesPatch(set, { minServings: null }).minServings).toBeNull()
    expect(applyNotesPatch(set, { notes: 'x' }).minServings).toBe(6)
  })
})
