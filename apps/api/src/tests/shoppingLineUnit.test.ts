/**
 * PRO-292: a menu line can be switched to another unit («Cebolla · 700 g» →
 * «5 u») from the list, and back. The switch survives the rebuild that every
 * GET /shopping-list does, and what was marked (bought / «en casa») follows
 * the line's current unit: switching never loses it.
 */
import { describe, expect, it } from 'vitest'
import type { BuyableUnit, ShoppingItem } from '@ona/shared'
import { carryItemState, editMenuLine, roundUpForUnit, UnitChangeError, type ConvertQty } from '../services/shoppingItemState.js'
import { convert } from '../services/shoppingList.js'

const menuLine = (extra: Partial<ShoppingItem> = {}): ShoppingItem =>
  ({ id: 'menu:ceb:g', ingredientId: 'ceb', name: 'cebolla', quantity: 700, unit: 'g', aisle: 'produce', checked: false, inStock: false, kind: 'menu', ...extra }) as ShoppingItem

// Onion: 150 g a piece, no density. Parsley: nothing converts.
const conv: ConvertQty = (id, q, from, to) => (id === 'ceb' ? convert(q, from, to, null, 150) : convert(q, from, to, null, null))
const RANGE = { today: '2026-10-20', rangeTo: '2026-11-01' }
const UNTIL = '2026-11-01'

describe('switching a menu line to another unit (PRO-292)', () => {
  it('converts what the line shows, rounded up to whole units, and survives the rebuild', () => {
    const row = menuLine()
    const state = editMenuLine(row, null, { unit: 'u' }, UNTIL, conv)
    expect(row).toMatchObject({ unit: 'u', quantity: 5, menuUnit: 'g', menuQuantity: 700 })
    expect(Object.keys(state)).toEqual(['ceb|g'])
    expect(state['ceb|g'].edit).toMatchObject({ unit: 'u', quantity: 5 })

    const rebuilt = carryItemState([menuLine()], [row], state, conv, RANGE)
    expect(rebuilt.items[0]).toMatchObject({ id: 'menu:ceb:g', unit: 'u', quantity: 5, menuUnit: 'g', menuQuantity: 700 })
  })

  it('takes the household amount in the new unit, and goes back to the menu with the unit alone', () => {
    const row = menuLine()
    let state = editMenuLine(row, null, { unit: 'u', quantity: 3 }, UNTIL, conv)
    expect(row).toMatchObject({ unit: 'u', quantity: 3 })
    // − / + in the new unit keeps it in that unit.
    state = editMenuLine(row, state, { quantity: 4 }, UNTIL, conv)
    expect(row).toMatchObject({ unit: 'u', quantity: 4, menuUnit: 'g' })

    state = editMenuLine(row, state, { unit: 'g' }, UNTIL, conv)
    expect(row.unit).toBe('g')
    expect(row.quantity).toBe(700)
    expect(row.menuUnit).toBeUndefined()
    expect(row.menuQuantity).toBeUndefined()
    expect(state['ceb|g']).toBeUndefined()

    const rebuilt = carryItemState([menuLine()], [row], state, conv, RANGE)
    expect(rebuilt.items[0]).toMatchObject({ unit: 'g', quantity: 700 })
    expect(rebuilt.items[0].menuUnit).toBeUndefined()
  })

  it('keeps bought and «en casa» across the switch, both ways', () => {
    const row = menuLine({ checked: true })
    const state = editMenuLine(row, null, { unit: 'u' }, UNTIL, conv)
    const inUnits = carryItemState([menuLine()], [row], state, conv, RANGE)
    expect(inUnits.items[0]).toMatchObject({ unit: 'u', checked: true })

    const line = inUnits.items[0]
    const back = editMenuLine(line, inUnits.state, { unit: 'g' }, UNTIL, conv)
    expect(line.checked).toBe(true)
    const inGrams = carryItemState([menuLine()], [line], back, conv, RANGE)
    expect(inGrams.items[0]).toMatchObject({ unit: 'g', quantity: 700, checked: true })

    const home = menuLine({ inStock: true })
    const s2 = editMenuLine(home, null, { unit: 'u' }, UNTIL, conv)
    const r2 = carryItemState([menuLine()], [home], s2, conv, RANGE)
    expect(r2.items[0]).toMatchObject({ unit: 'u', inStock: true })
    // A range without the onion and back: still in units and «en casa».
    const away = carryItemState([], r2.items, r2.state, conv, RANGE)
    const again = carryItemState([menuLine()], away.items, away.state, conv, RANGE)
    expect(again.items[0]).toMatchObject({ unit: 'u', inStock: true })
  })

  it('refuses a unit the ingredient cannot be converted to', () => {
    const perejil = menuLine({ id: 'menu:per:g', ingredientId: 'per', name: 'perejil', quantity: 25 })
    expect(() => editMenuLine(perejil, null, { unit: 'u' }, UNTIL, conv)).toThrow(UnitChangeError)
    expect(perejil.unit).toBe('g')
  })

  it('keeps what the line costs when the unit changes', () => {
    const row = menuLine({ pricePerUnit: 0.002 }) // 1,40 € for 700 g
    editMenuLine(row, null, { unit: 'u' }, UNTIL, conv)
    expect(row.pricePerUnit! * row.quantity).toBeCloseTo(1.4)
  })

  it('rounds converted amounts up to what a shop sells', () => {
    const cases: Array<[number, BuyableUnit, number]> = [
      [4.67, 'u', 5],
      [2.1, 'u', 3],
      [2.01, 'u', 2],
      [3.0000001, 'u', 3],
      [0.2, 'u', 1],
      [130, 'g', 150],
      [610, 'g', 650],
      [1210, 'g', 1300],
      [1.2, 'cda', 1.5],
    ]
    for (const [q, u, want] of cases) expect(roundUpForUnit(q, u)).toBe(want)
  })
})
