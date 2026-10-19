/**
 * PRO-182: «nos queda una cebolla y medio pimiento» used to mark the whole
 * week's 7 onions «en casa». Now the household says how much is left and the
 * list buys only the rest, also after the rebuild of every GET.
 */
import { describe, expect, it } from 'vitest'
import { missingQuantity, type ShoppingItem } from '@ona/shared'
import { carryItemState, setHaveAtHome } from '../services/shoppingItemState.js'

const item = (ingredientId: string, quantity: number, unit = 'u', extra: Partial<ShoppingItem> = {}): ShoppingItem =>
  ({ id: `menu:${ingredientId}:${unit}`, ingredientId, name: ingredientId, quantity, unit, aisle: 'produce', checked: false, inStock: false, kind: 'menu', ...extra }) as ShoppingItem

describe('setHaveAtHome (PRO-182)', () => {
  it('7 onions − 1 at home = 6 to buy, and the rebuild keeps it', () => {
    const cebolla = setHaveAtHome(item('cebolla', 7), 1)
    expect(cebolla).toMatchObject({ inStock: false, checked: false, haveQuantity: 1, haveSource: 'inStock' })
    expect(missingQuantity(cebolla)).toBe(6)

    const rebuilt = carryItemState([item('cebolla', 7)], [cebolla], null)
    expect(missingQuantity(rebuilt.items[0])).toBe(6)
    expect(rebuilt.items[0].inStock).toBe(false)
  })

  it('what is at home is subtracted from what the menu asks later', () => {
    const huevos = setHaveAtHome(item('huevo', 14), 4)
    const later = carryItemState([item('huevo', 10)], [huevos], null)
    expect(missingQuantity(later.items[0])).toBe(6)
  })

  it('half a pepper does not save buying a whole one; grams subtract', () => {
    const pimiento = setHaveAtHome(item('pimiento', 5), 0.5)
    expect(missingQuantity(pimiento)).toBe(5)
    expect(pimiento.inStock).toBe(false)
    const arroz = setHaveAtHome(item('arroz', 500, 'g'), 200)
    expect(missingQuantity(arroz)).toBe(300)
  })

  it('as much as the line marks it «en casa»; 0 clears it', () => {
    const ajo = setHaveAtHome(item('ajo', 3), 5)
    expect(ajo).toMatchObject({ inStock: true })
    expect(ajo.haveQuantity).toBeUndefined()
    const back = setHaveAtHome(ajo, 0)
    expect(back.inStock).toBe(false)
    expect(missingQuantity(back)).toBe(3)
  })
})

describe('joined lines (PRO-177 + PRO-182)', () => {
  it('«nos quedan 4 huevos» on a joined line keeps the rest to buy after the rebuild', () => {
    const huevos = setHaveAtHome(item('huevo', 14, 'u', { mergedIngredientIds: ['yema'] }), 4)
    const rebuilt = carryItemState([item('huevo', 14, 'u', { mergedIngredientIds: ['yema'] })], [huevos], null)
    expect(rebuilt.items[0].inStock).toBe(false)
    expect(missingQuantity(rebuilt.items[0])).toBe(10)
  })
})
