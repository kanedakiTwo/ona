/**
 * Pure-logic tests for `sanitizeCustomTags` (PR 8B). Each custom tag is:
 *   - trimmed
 *   - lowercased (so "Vegano" and "vegano" don't accumulate as two rows)
 *   - capped at 30 chars
 *   - deduped against the rest of the array
 * The whole array is capped at 10 tags. Invalid inputs (non-strings,
 * empty after trim) are silently dropped.
 */
import { describe, expect, it } from 'vitest'
import { sanitizeCustomTags } from '../services/recipeNotesStore.js'

describe('sanitizeCustomTags', () => {
  it('returns [] for null / undefined / empty', () => {
    expect(sanitizeCustomTags(null)).toEqual([])
    expect(sanitizeCustomTags(undefined)).toEqual([])
    expect(sanitizeCustomTags([])).toEqual([])
  })
  it('trims + lowercases each entry', () => {
    expect(sanitizeCustomTags(['  Vegano  ', 'SIN GLUTEN', 'rapido'])).toEqual([
      'vegano',
      'sin gluten',
      'rapido',
    ])
  })
  it('dedups case-insensitively while preserving first-occurrence order', () => {
    expect(sanitizeCustomTags(['vegano', 'Vegano', 'VEGANO', 'rapido'])).toEqual([
      'vegano',
      'rapido',
    ])
  })
  it('drops empty / whitespace-only / non-string entries', () => {
    expect(sanitizeCustomTags(['', '   ', null as any, 42 as any, 'ok'])).toEqual(['ok'])
  })
  it('truncates each tag at 30 chars', () => {
    const long = 'x'.repeat(50)
    const out = sanitizeCustomTags([long])
    expect(out[0].length).toBe(30)
  })
  it('caps the array at 10 tags (drops the rest silently)', () => {
    const many = Array.from({ length: 15 }, (_, i) => `tag${i}`)
    const out = sanitizeCustomTags(many)
    expect(out).toHaveLength(10)
    expect(out[0]).toBe('tag0')
    expect(out[9]).toBe('tag9')
  })
  it('rejects non-array input as []', () => {
    expect(sanitizeCustomTags('not an array' as any)).toEqual([])
    expect(sanitizeCustomTags({} as any)).toEqual([])
  })
})
