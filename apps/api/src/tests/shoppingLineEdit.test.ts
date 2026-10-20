/**
 * PRO-175: a menu line can be left out («No lo compro esta semana») or get
 * the household's own amount, and the change survives the rebuild that every
 * GET /shopping-list does. It applies to lists ending on or before the day it
 * was set for, and is forgotten after that day.
 */
import { describe, expect, it } from 'vitest'
import { activeShoppingItems, shoppingProgress, type ShoppingItem } from '@ona/shared'
import { carryItemState, editMenuLine } from '../services/shoppingItemState.js'
import { computeListTotal } from '../services/shoppingList.js'
import { shoppingListDigest } from '../services/shoppingText.js'

const item = (ingredientId: string, unit = 'g', extra: Partial<ShoppingItem> = {}): ShoppingItem =>
  ({ id: `menu:${ingredientId}:${unit}`, ingredientId, name: ingredientId, quantity: 1000, unit, aisle: 'produce', checked: false, inStock: false, kind: 'menu', ...extra }) as ShoppingItem

const UNTIL = '2026-11-01'

describe('editMenuLine + carryItemState (PRO-175)', () => {
  it('a line left out stays out after the rebuild, and comes back when undone', () => {
    const patata = item('patata')
    const state = editMenuLine(patata, null, { skipped: true }, UNTIL)
    expect(patata.skipped).toBe(true)
    const rebuilt = carryItemState([item('patata'), item('ajo')], [patata], state, undefined, { today: '2026-10-20', rangeTo: UNTIL })
    expect(rebuilt.items.find((i) => i.ingredientId === 'patata')?.skipped).toBe(true)
    expect(rebuilt.items.find((i) => i.ingredientId === 'ajo')?.skipped).toBeUndefined()

    const back = rebuilt.items.find((i) => i.ingredientId === 'patata')!
    const undone = editMenuLine(back, rebuilt.state, { skipped: false }, UNTIL)
    const again = carryItemState([item('patata')], rebuilt.items, undone, undefined, { today: '2026-10-20', rangeTo: UNTIL })
    expect(again.items[0].skipped).toBeUndefined()
    expect(again.state['patata|g']).toBeUndefined()
  })

  it('a changed amount is kept, with what the menu asked for', () => {
    const yogur = item('yogur', 'u', { quantity: 6 })
    const state = editMenuLine(yogur, null, { quantity: 8 }, UNTIL)
    expect(yogur).toMatchObject({ quantity: 8, menuQuantity: 6 })
    const rebuilt = carryItemState([item('yogur', 'u', { quantity: 6 })], [yogur], state, undefined, { today: '2026-10-20', rangeTo: UNTIL })
    expect(rebuilt.items[0]).toMatchObject({ quantity: 8, menuQuantity: 6 })
    // Setting it back to the menu's amount forgets the change.
    const reset = editMenuLine(rebuilt.items[0], rebuilt.state, { quantity: 6 }, UNTIL)
    expect(rebuilt.items[0].menuQuantity).toBeUndefined()
    expect(reset['yogur|u']).toBeUndefined()
  })

  it('a list reaching past the day shows the line as the menu asks, and coming back keeps the change', () => {
    const patata = item('patata')
    const state = editMenuLine(patata, null, { skipped: true, quantity: 500 }, UNTIL)
    const later = carryItemState([item('patata')], [patata], state, undefined, { today: '2026-10-20', rangeTo: '2026-11-08' })
    expect(later.items[0]).toMatchObject({ quantity: 1000 })
    expect(later.items[0].skipped).toBeUndefined()
    const back = carryItemState([item('patata')], later.items, later.state, undefined, { today: '2026-10-20', rangeTo: '2026-10-20' })
    expect(back.items[0]).toMatchObject({ skipped: true, quantity: 500, menuQuantity: 1000 })
  })

  it('is forgotten after its day', () => {
    const state = editMenuLine(item('patata'), null, { skipped: true }, UNTIL)
    const next = carryItemState([item('patata')], [], state, undefined, { today: '2026-11-02', rangeTo: '2026-11-15' })
    expect(next.items[0].skipped).toBeUndefined()
    expect(next.state['patata|g']).toBeUndefined()
  })

  it('a line left out counts for nothing: not in the progress, the total or what is left', () => {
    const items = [item('patata', 'g', { skipped: true, pricePerUnit: 0.002 }), item('ajo', 'g', { pricePerUnit: 0.01 })]
    expect(shoppingProgress(items).total).toBe(1)
    expect(computeListTotal(items).totalEur).toBeCloseTo(10)
    expect(activeShoppingItems(items).map((i) => i.ingredientId)).toEqual(['ajo'])
  })

  it('the WhatsApp summary leaves out lines left out and shows «2 paquetes» as said', () => {
    const items = [
      item('patata', 'g', { name: 'Patata', skipped: true }),
      { ...item('x', 'u', { name: 'Pañales talla 4', quantity: 2, kind: 'manual', amountText: '2 paquetes' }), ingredientId: null } as ShoppingItem,
    ]
    const text = shoppingListDigest(items)
    expect(text).not.toContain('Patata')
    expect(text).toContain('Pañales talla 4 (2 paquetes)')
  })
})

describe('parseShoppingAmount (PRO-175)', () => {
  it('a number is a quantity; words are kept as written; empty is nothing', async () => {
    const { parseShoppingAmount } = await import('@ona/shared')
    expect(parseShoppingAmount('2')).toEqual({ quantity: 2 })
    expect(parseShoppingAmount('1,5')).toEqual({ quantity: 1.5 })
    expect(parseShoppingAmount('  2  paquetes ')).toEqual({ amountText: '2 paquetes' })
    expect(parseShoppingAmount('')).toBeNull()
    expect(parseShoppingAmount('0')).toBeNull()
  })
})
