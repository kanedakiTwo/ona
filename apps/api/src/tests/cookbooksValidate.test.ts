/**
 * Pure-logic tests for the cookbook name / emoji / description validators
 * (PR 8A). Kept as pure functions so a regression in trim / length /
 * emoji-shape rules trips a unit failure before reaching the DB CHECK.
 */
import { describe, expect, it } from 'vitest'
import {
  validateCookbookName,
  validateCookbookEmoji,
  validateCookbookDescription,
} from '../services/cookbooksStore.js'

describe('validateCookbookName', () => {
  it('accepts a typical Spanish name', () => {
    expect(validateCookbookName('Favoritos de Sara')).toEqual({
      ok: true,
      value: 'Favoritos de Sara',
    })
  })
  it('trims leading + trailing whitespace', () => {
    expect(validateCookbookName('  Para diabéticos  ')).toEqual({
      ok: true,
      value: 'Para diabéticos',
    })
  })
  it('rejects empty + whitespace-only', () => {
    expect(validateCookbookName('').ok).toBe(false)
    expect(validateCookbookName('   ').ok).toBe(false)
  })
  it('rejects names longer than 60 chars (after trim)', () => {
    const long = 'a'.repeat(61)
    expect(validateCookbookName(long).ok).toBe(false)
    const exact = 'a'.repeat(60)
    expect(validateCookbookName(exact)).toEqual({ ok: true, value: exact })
  })
})

describe('validateCookbookEmoji', () => {
  it('accepts a single emoji', () => {
    expect(validateCookbookEmoji('📖')).toEqual({ ok: true, value: '📖' })
    expect(validateCookbookEmoji('🥗')).toEqual({ ok: true, value: '🥗' })
  })
  it('accepts null / undefined / empty (defaults to null)', () => {
    expect(validateCookbookEmoji(null)).toEqual({ ok: true, value: null })
    expect(validateCookbookEmoji(undefined)).toEqual({ ok: true, value: null })
    expect(validateCookbookEmoji('')).toEqual({ ok: true, value: null })
  })
  it('rejects anything longer than 8 chars (composed emoji + ZWJ sequences allowed up to 8)', () => {
    // 8 chars cap is generous — accommodates ZWJ sequences like 👨‍👩‍👧.
    expect(validateCookbookEmoji('aaaaaaaaa').ok).toBe(false)
  })
})

describe('validateCookbookDescription', () => {
  it('null / empty → null', () => {
    expect(validateCookbookDescription(null)).toEqual({ ok: true, value: null })
    expect(validateCookbookDescription('   ')).toEqual({ ok: true, value: null })
  })
  it('trims + caps at 280 chars', () => {
    const exact = 'x'.repeat(280)
    expect(validateCookbookDescription(exact)).toEqual({ ok: true, value: exact })
    expect(validateCookbookDescription('y'.repeat(281)).ok).toBe(false)
    expect(validateCookbookDescription('  hello  ')).toEqual({ ok: true, value: 'hello' })
  })
})
