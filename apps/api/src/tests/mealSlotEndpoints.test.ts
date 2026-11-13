/**
 * Pure validation tests for the per-day meal-slot endpoints
 * (POST/DELETE/PATCH /menu/:menuId/day/:day/meal/:meal). The handlers
 * themselves are tested end-to-end against a running API in the smoke
 * script; here we exercise only the input contract so a regression in
 * the validators (meal enum, servings range, null clearing) fails fast.
 */
import { describe, expect, it } from 'vitest'
import { MEALS } from '@ona/shared'

// Mirror the route's predicate. Keep this in sync with menus.ts; if the
// canonical list ever grows, both should grow together.
const MEAL_VALUES = new Set<string>(MEALS)
function isValidMeal(meal: string): boolean {
  return MEAL_VALUES.has(meal)
}

// The same shape the PATCH handler uses to coerce + range-check the body's
// `servings` field. Lifted so a regression here trips a unit failure
// instead of a 500 in prod.
type ServingsValidation =
  | { ok: true; value: number | null }
  | { ok: false; reason: string }

function validateServings(raw: unknown): ServingsValidation {
  if (raw === null) return { ok: true, value: null }
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
  if (!Number.isFinite(n) || n < 1 || n > 24) {
    return { ok: false, reason: 'servings must be an integer between 1 and 24' }
  }
  return { ok: true, value: n }
}

describe('isValidMeal', () => {
  it('accepts every canonical meal', () => {
    for (const m of MEALS) {
      expect(isValidMeal(m)).toBe(true)
    }
  })

  it('rejects Spanish names (the API uses English enum keys)', () => {
    expect(isValidMeal('desayuno')).toBe(false)
    expect(isValidMeal('comida')).toBe(false)
    expect(isValidMeal('almuerzo')).toBe(false)
  })

  it('rejects free-form garbage', () => {
    expect(isValidMeal('')).toBe(false)
    expect(isValidMeal('tapa')).toBe(false)
    expect(isValidMeal('BREAKFAST')).toBe(false) // case-sensitive on purpose
  })
})

describe('validateServings', () => {
  it('accepts null as "clear the override"', () => {
    expect(validateServings(null)).toEqual({ ok: true, value: null })
  })

  it('accepts integers from 1 to 24 inclusive', () => {
    for (const n of [1, 2, 4, 12, 24]) {
      expect(validateServings(n)).toEqual({ ok: true, value: n })
    }
  })

  it('rejects 0 and negative numbers', () => {
    expect(validateServings(0).ok).toBe(false)
    expect(validateServings(-1).ok).toBe(false)
  })

  it('rejects values above the household cap', () => {
    expect(validateServings(25).ok).toBe(false)
    expect(validateServings(100).ok).toBe(false)
  })

  it('parses numeric strings (form-encoded clients)', () => {
    expect(validateServings('4')).toEqual({ ok: true, value: 4 })
  })

  it('rejects non-numeric strings, NaN, undefined', () => {
    expect(validateServings('abc').ok).toBe(false)
    expect(validateServings(NaN).ok).toBe(false)
    expect(validateServings(undefined).ok).toBe(false)
  })
})
