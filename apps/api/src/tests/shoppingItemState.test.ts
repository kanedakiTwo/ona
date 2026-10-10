/**
 * The shopping list remembers what the user marked across rebuilds
 * (2026-10-10): mark a product "en casa", look at a week without it, come
 * back → still "en casa". Before, the single rolling row only carried state
 * for products present in the previous range.
 */
import { describe, expect, it } from 'vitest'
import type { ShoppingItem } from '@ona/shared'
import { carryItemState, ITEM_STATE_MAX } from '../services/shoppingItemState.js'

const item = (ingredientId: string, unit = 'g', extra: Partial<ShoppingItem> = {}): ShoppingItem =>
  ({ id: `menu:${ingredientId}:${unit}`, ingredientId, name: ingredientId, quantity: 100, unit, aisle: 'produce', checked: false, inStock: false, kind: 'menu', ...extra }) as ShoppingItem

describe('carryItemState', () => {
  it('a product absent from the range on screen keeps its state for when it comes back', () => {
    // This week: onions marked at home.
    const week1 = [item('cebolla', 'g', { inStock: true }), item('ajo')]
    // Next week has no onions: rebuilt from week 1's rows.
    const step1 = carryItemState([item('ajo')], week1, null)
    expect(step1.items.map((i) => i.ingredientId)).toEqual(['ajo'])
    expect(step1.state['cebolla|g']).toEqual({ checked: false, inStock: true, pricePerUnit: null })
    // Back to this week: rebuilt from next week's rows + the remembered state.
    const step2 = carryItemState([item('cebolla'), item('ajo')], step1.items, step1.state)
    expect(step2.items.find((i) => i.ingredientId === 'cebolla')?.inStock).toBe(true)
  })

  it('the latest rows win over the older memory', () => {
    const remembered = { 'ajo|g': { checked: true, inStock: false, pricePerUnit: 2 } }
    const prev = [item('ajo', 'g', { checked: false, pricePerUnit: 3 })]
    const { items, state } = carryItemState([item('ajo')], prev, remembered)
    expect(items[0]).toMatchObject({ checked: false, pricePerUnit: 3 })
    expect(state['ajo|g']).toEqual({ checked: false, inStock: false, pricePerUnit: 3 })
  })

  it('keys by ingredient and unit, ignores manual rows and forgets empty states', () => {
    const prev = [
      item('jengibre', 'g', { checked: true }),
      item('jengibre', 'u'),
      { ...item('x'), ingredientId: null, kind: 'manual', name: 'Galletas', checked: true } as ShoppingItem,
    ]
    const { items, state } = carryItemState([item('jengibre', 'g'), item('jengibre', 'u')], prev, null)
    expect(items.map((i) => i.checked)).toEqual([true, false])
    expect(Object.keys(state)).toEqual(['jengibre|g'])
  })

  it('remembers at most ITEM_STATE_MAX products, dropping the oldest', () => {
    const many = Object.fromEntries(Array.from({ length: ITEM_STATE_MAX + 10 }, (_, i) => [`i${i}|g`, { checked: true, inStock: false, pricePerUnit: null }]))
    const { state } = carryItemState([], [], many)
    expect(Object.keys(state)).toHaveLength(ITEM_STATE_MAX)
    expect(state['i0|g']).toBeUndefined()
    expect(state[`i${ITEM_STATE_MAX + 9}|g`]).toBeDefined()
  })
})
