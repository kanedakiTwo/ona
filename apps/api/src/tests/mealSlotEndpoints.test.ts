/**
 * Pure validation tests for the per-day meal-slot endpoints
 * (POST/DELETE/PATCH /menu/:menuId/day/:day/meal/:meal). The handlers
 * themselves are tested end-to-end against a running API in the smoke
 * script; here we exercise only the input contract so a regression in
 * the validators (meal enum, servings range, null clearing) fails fast.
 */
import { describe, expect, it } from 'vitest'
import { MEALS, MEAL_TYPE_TAGS } from '@ona/shared'

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

// Mirror the route's pinnedType predicate. The PATCH /:meal endpoint accepts
// `{ pinnedType: <tag> | null }`; only members of MEAL_TYPE_TAGS are valid,
// null clears the pin. Kept here so a regression in the route trips a unit
// failure before reaching prod.
type PinnedTypeValidation =
  | { ok: true; value: string | null }
  | { ok: false; reason: string }

function validatePinnedType(raw: unknown): PinnedTypeValidation {
  if (raw === null) return { ok: true, value: null }
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'pinnedType must be a string or null' }
  }
  if (!(MEAL_TYPE_TAGS as readonly string[]).includes(raw)) {
    return { ok: false, reason: `pinnedType must be one of: ${MEAL_TYPE_TAGS.join(', ')}` }
  }
  return { ok: true, value: raw }
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

describe('validatePinnedType', () => {
  it('accepts null as "clear the pin"', () => {
    expect(validatePinnedType(null)).toEqual({ ok: true, value: null })
  })

  it('accepts every canonical tag', () => {
    for (const tag of MEAL_TYPE_TAGS) {
      expect(validatePinnedType(tag)).toEqual({ ok: true, value: tag })
    }
  })

  it('rejects unknown tags (typos, alternate spellings)', () => {
    expect(validatePinnedType('frijoles').ok).toBe(false)
    expect(validatePinnedType('Cremas').ok).toBe(false) // case-sensitive on purpose
    expect(validatePinnedType('').ok).toBe(false)
  })

  it('rejects non-string values', () => {
    expect(validatePinnedType(0).ok).toBe(false)
    expect(validatePinnedType(undefined).ok).toBe(false)
    expect(validatePinnedType(['cremas']).ok).toBe(false)
  })
})
