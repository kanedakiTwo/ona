/**
 * Pure-logic tests for `computeListTotal` — the reducer that turns a list's
 * items into `{ totalEur, pricedCount, unpricedCount }`. The route hands
 * this back to the client so a regression in arithmetic or null-handling
 * trips a unit failure instead of a wrong subtotal in the UI.
 */
import { describe, expect, it } from 'vitest'
import type { ShoppingItem } from '@ona/shared'
import { computeListTotal } from '../services/shoppingList.js'

function item(overrides: Partial<ShoppingItem>): ShoppingItem {
  return {
    id: 'i-' + Math.random().toString(36).slice(2, 8),
    ingredientId: 'ing-1',
    name: 'X',
    quantity: 1,
    unit: 'u',
    aisle: 'otros',
    checked: false,
    inStock: false,
    ...overrides,
  }
}

describe('computeListTotal', () => {
  it('returns zero on an empty list', () => {
    const t = computeListTotal([])
    expect(t).toEqual({ totalEur: 0, pricedCount: 0, unpricedCount: 0 })
  })

  it('sums quantity × pricePerUnit when both are set', () => {
    const items: ShoppingItem[] = [
      item({ quantity: 2, pricePerUnit: 1.5 }),  // 3.00
      item({ quantity: 4, pricePerUnit: 0.5 }),  // 2.00
    ]
    expect(computeListTotal(items).totalEur).toBeCloseTo(5, 5)
  })

  it('counts priced vs unpriced rows', () => {
    const items: ShoppingItem[] = [
      item({ pricePerUnit: 2 }),
      item({ pricePerUnit: 3 }),
      item({ pricePerUnit: null }),
      item({}), // pricePerUnit absent
    ]
    const t = computeListTotal(items)
    expect(t.pricedCount).toBe(2)
    expect(t.unpricedCount).toBe(2)
  })

  it('skips checked items that are already inStock (already-have-it does not count toward spend)', () => {
    const items: ShoppingItem[] = [
      item({ quantity: 2, pricePerUnit: 1, inStock: true }), // skip
      item({ quantity: 2, pricePerUnit: 1, inStock: false }), // 2.00
    ]
    expect(computeListTotal(items).totalEur).toBeCloseTo(2, 5)
  })

  it('handles 0-quantity and negative-quantity defensively (skips them)', () => {
    const items: ShoppingItem[] = [
      item({ quantity: 0, pricePerUnit: 5 }),
      item({ quantity: -3, pricePerUnit: 5 }),
      item({ quantity: 2, pricePerUnit: 5 }), // 10.00
    ]
    expect(computeListTotal(items).totalEur).toBeCloseTo(10, 5)
  })
})
