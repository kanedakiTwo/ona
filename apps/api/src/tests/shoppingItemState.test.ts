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
    expect(step1.state['cebolla|g']).toEqual({ checked: false, inStock: true, pricePerUnit: null, quantity: 100 })
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

  // PRO-199 (Familia Ruiz, Laura, 2026-10-17): changing a dish changed the
  // line's unit and what was bought came back pending.
  describe('what was marked follows the ingredient, whatever the unit', () => {
    // Ajo: 5 g a clove. Zanahoria: 80 g each.
    const weights: Record<string, number> = { ajo: 5, zanahoria: 80 }
    const convert = (id: string, q: number, from: string, to: string) => {
      const w = weights[id]
      if (!w) return null
      if (from === 'u' && to === 'g') return q * w
      if (from === 'g' && to === 'u') return q / w
      return null
    }

    it('«Ajo · 8 u» bought, then the menu asks «Ajo · 25 g» → still bought', () => {
      const prev = [item('ajo', 'u', { quantity: 8, checked: true })]
      const { items, state } = carryItemState([item('ajo', 'g', { quantity: 25 })], prev, null, convert)
      expect(items[0]).toMatchObject({ unit: 'g', quantity: 25, checked: true })
      expect(items[0].haveQuantity).toBeUndefined()
      // And it stays bought on the next rebuild too.
      const again = carryItemState([item('ajo', 'g', { quantity: 25 })], items, state, convert)
      expect(again.items[0].checked).toBe(true)
    })

    it('without a known conversion the line stays marked', () => {
      const prev = [item('perejil', 'u', { quantity: 1, inStock: true })]
      const { items } = carryItemState([item('perejil', 'g', { quantity: 30 })], prev, null, convert)
      expect(items[0]).toMatchObject({ inStock: true })
    })

    it('the menu asks for more than what was bought → pending for the rest («Te faltan»)', () => {
      // Laura: 150 g of carrot ticked, the new menu wants 3 carrots (240 g).
      const prev = [item('zanahoria', 'g', { quantity: 150, checked: true })]
      const { items, state } = carryItemState([item('zanahoria', 'u', { quantity: 3 })], prev, null, convert)
      expect(items[0]).toMatchObject({ checked: false, inStock: false, haveSource: 'checked' })
      expect(items[0].quantity - items[0].haveQuantity!).toBe(2) // 1.9 carrots had → 2 more to buy
      // The partial line still remembers the 150 g on the next rebuild.
      const again = carryItemState([item('zanahoria', 'u', { quantity: 3 })], items, state, convert)
      expect(again.items[0]).toMatchObject({ checked: false, haveQuantity: 1 })
    })

    it('same unit, more needed → says how much is missing; less needed → stays bought', () => {
      const prev = [item('ajo', 'g', { quantity: 25, inStock: true })]
      const more = carryItemState([item('ajo', 'g', { quantity: 40 })], prev, null, convert)
      expect(more.items[0]).toMatchObject({ inStock: false, haveQuantity: 25, haveSource: 'inStock' })
      const less = carryItemState([item('ajo', 'g', { quantity: 20 })], prev, null, convert)
      expect(less.items[0]).toMatchObject({ inStock: true })
    })

    it('a mark remembered before amounts were stored covers any amount', () => {
      const remembered = { 'ajo|u': { checked: true, inStock: false, pricePerUnit: null } }
      const { items } = carryItemState([item('ajo', 'g', { quantity: 500 })], [], remembered, convert)
      expect(items[0].checked).toBe(true)
    })

    it('the previous list wins over an older mark of the same ingredient in another unit', () => {
      const remembered = { 'ajo|g': { checked: true, inStock: false, pricePerUnit: null, quantity: 50 } }
      const prev = [item('ajo', 'u', { quantity: 8, checked: false })]
      const { items } = carryItemState([item('ajo', 'g', { quantity: 25 })], prev, remembered, convert)
      expect(items[0].checked).toBe(false)
    })
  })
})
