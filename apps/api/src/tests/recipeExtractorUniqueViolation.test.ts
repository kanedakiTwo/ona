import { describe, expect, it } from 'vitest'
import { isUniqueViolation } from '../services/recipeExtractor.js'

describe('isUniqueViolation — a new ingredient created twice reuses the first row', () => {
  it('reads the code on the error or on its cause (DrizzleQueryError)', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
    expect(isUniqueViolation({ message: 'Failed query', cause: { code: '23505' } })).toBe(true)
  })
  it('anything else is a real failure', () => {
    expect(isUniqueViolation({ cause: { code: '23503' } })).toBe(false)
    expect(isUniqueViolation(new Error('boom'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
})
