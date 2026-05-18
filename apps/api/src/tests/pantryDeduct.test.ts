/**
 * Pure-logic tests for `applyPantryDeduct` — the reducer that updates a
 * pantry row's quantity when a recipe is cooked. Skips silently if units
 * don't match (v1 ships without cross-unit conversion); clamps at 0; never
 * goes negative.
 */
import { describe, expect, it } from 'vitest'
import { applyPantryDeduct } from '../services/pantryStore.js'

describe('applyPantryDeduct', () => {
  it('subtracts deducted amount when units match', () => {
    const r = applyPantryDeduct({ quantity: 5, unit: 'u' }, { quantity: 2, unit: 'u' })
    expect(r).toEqual({ changed: true, newQuantity: 3, reason: null })
  })

  it('clamps at 0 when deducting more than current', () => {
    const r = applyPantryDeduct({ quantity: 1, unit: 'u' }, { quantity: 5, unit: 'u' })
    expect(r).toEqual({ changed: true, newQuantity: 0, reason: null })
  })

  it('returns no-op when units mismatch (cross-unit conversion deferred)', () => {
    const r = applyPantryDeduct({ quantity: 500, unit: 'g' }, { quantity: 1, unit: 'u' })
    expect(r.changed).toBe(false)
    expect(r.reason).toMatch(/unidad/i)
  })

  it('returns no-op when deduct quantity is 0 or negative', () => {
    expect(applyPantryDeduct({ quantity: 5, unit: 'u' }, { quantity: 0, unit: 'u' }).changed).toBe(false)
    expect(applyPantryDeduct({ quantity: 5, unit: 'u' }, { quantity: -1, unit: 'u' }).changed).toBe(false)
  })

  it('returns no-op when current quantity is already 0 (nothing to deduct)', () => {
    const r = applyPantryDeduct({ quantity: 0, unit: 'u' }, { quantity: 1, unit: 'u' })
    expect(r.changed).toBe(false)
  })

  it('rounds floating arithmetic to 3 decimals to avoid 0.99999… surprises', () => {
    const r = applyPantryDeduct({ quantity: 0.3, unit: 'kg' }, { quantity: 0.1, unit: 'kg' })
    expect(r.changed).toBe(true)
    expect(r.newQuantity).toBeCloseTo(0.2, 5)
  })
})
