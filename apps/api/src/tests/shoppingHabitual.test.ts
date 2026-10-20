/**
 * PRO-293: «Habitual» on a line of the list. Menu lines that are a staple
 * read habitual; a manual line marked habitual becomes the staple line; a
 * staple line switched off leaves the list.
 */
import { describe, expect, it } from 'vitest'
import type { ShoppingItem } from '@ona/shared'
import { applyHabitualToRows, stapleFromLine, stapleItemId, withHabitual } from '../services/shoppingHabitual.js'
import { mergeStaplesIntoItems } from '../services/shoppingList.js'

const row = (id: string, name: string, extra: Partial<ShoppingItem> = {}): ShoppingItem =>
  ({ id, ingredientId: null, name, quantity: 1, unit: 'u', aisle: 'otros', checked: false, inStock: false, ...extra }) as ShoppingItem

describe('habitual lines (PRO-293)', () => {
  it('a menu line whose name is an active staple reads habitual; others do not', () => {
    const items = [row('menu:ceb:g', 'cebolla', { ingredientId: 'ceb', kind: 'menu', unit: 'g', quantity: 700 }), row('menu:ajo:u', 'ajo', { ingredientId: 'ajo', kind: 'menu', habitual: true })]
    const out = withHabitual(items, ['Cebolla '])
    expect(out[0].habitual).toBe(true)
    expect(out[1].habitual).toBeUndefined()
  })

  it('the staple made from a line keeps its name, amount, unit, aisle and price, and its id is the staple line id', () => {
    const line = row('menu:ceb:g', 'cebolla', { ingredientId: 'ceb', kind: 'menu', unit: 'g', quantity: 700, aisle: 'produce', pricePerUnit: 0.002 })
    expect(stapleFromLine(line)).toEqual({ name: 'cebolla', quantity: 700, unit: 'g', aisle: 'produce', pricePerUnit: 0.002 })
    const [staple] = mergeStaplesIntoItems([], [{ ...stapleFromLine(row('m1', 'Galletas María')), active: true } as any])
    expect(staple.id).toBe(stapleItemId('Galletas María'))
  })

  it('a manual line marked habitual becomes the staple line; off on a staple line takes it off the list', () => {
    const manual = row('m1', 'Galletas', { kind: 'manual', quantity: 2, checked: true })
    const menu = row('menu:ceb:g', 'cebolla', { ingredientId: 'ceb', kind: 'menu' })
    const on = applyHabitualToRows([menu, manual], manual, true)
    expect(on.map((i) => [i.id, i.kind])).toEqual([['menu:ceb:g', 'menu'], ['staple:galletas', 'staple']])
    expect(on[1]).toMatchObject({ quantity: 2, checked: true })

    const menuOn = applyHabitualToRows(on, menu, true)
    expect(menuOn[0].habitual).toBe(true)
    const menuOff = applyHabitualToRows(menuOn, menuOn[0], false)
    expect(menuOff[0].habitual).toBeUndefined()

    const off = applyHabitualToRows(on, on[1], false)
    expect(off.map((i) => i.id)).toEqual(['menu:ceb:g'])
  })
})
