/**
 * PRO-1265 (Dani y Sara, 2026-11-17): «Ya en casa» showed «Tortillas de maíz
 * sin gluten 4 u» and «Calabacín 1 u» with neither in the pantry — an «en
 * casa» remembered from an older week. On every rebuild a line keeps «en
 * casa» only for what the pantry has now.
 */
import { describe, expect, it } from 'vitest'
import { missingQuantity, type ShoppingItem } from '@ona/shared'
import { sameName, withPantryAtHome, type PantryAmount } from '../services/shoppingPantry.js'
import { carryItemState } from '../services/shoppingItemState.js'

const line = (ingredientId: string, quantity: number, unit = 'u', extra: Partial<ShoppingItem> = {}): ShoppingItem =>
  ({ id: `menu:${ingredientId}:${unit}`, ingredientId, name: ingredientId, quantity, unit, aisle: 'produce', checked: false, inStock: false, kind: 'menu', ...extra }) as ShoppingItem
const manual = (name: string, extra: Partial<ShoppingItem> = {}): ShoppingItem =>
  ({ id: `m-${name}`, ingredientId: null, name, quantity: 1, unit: 'u', aisle: 'otros', checked: false, inStock: false, kind: 'manual', ...extra }) as ShoppingItem
const row = (name: string, quantity: number, unit = 'u', ingredientId: string | null = null): PantryAmount => ({ ingredientId, name, quantity, unit })
const atHome = (items: ShoppingItem[]) => items.filter((i) => i.inStock).map((i) => i.name)

describe('withPantryAtHome (PRO-1265)', () => {
  it('with an empty pantry nothing is «Ya en casa», even what the memory marked', () => {
    // The memory of an older week marks tortillas and calabacín «en casa».
    const { items } = carryItemState(
      [line('tortillas', 4), line('calabacin', 1)],
      [],
      { 'tortillas|u': { checked: false, inStock: true, pricePerUnit: null, quantity: 4 }, 'calabacin|u': { checked: false, inStock: true, pricePerUnit: null } },
    )
    expect(atHome(items)).toEqual(['tortillas', 'calabacin'])
    const out = withPantryAtHome([...items, manual('Tamari (salsa de soja sin gluten)', { inStock: true })], [])
    expect(atHome(out)).toEqual([])
    expect(out.every((i) => !i.mark && !i.haveQuantity)).toBe(true)
  })

  it('as much as the line in the pantry → stays «en casa»; less → pending for the rest', () => {
    const out = withPantryAtHome(
      [line('tortillas', 4, 'u', { inStock: true }), line('arroz', 500, 'g', { inStock: true })],
      [row('Tortillas', 6, 'u', 'tortillas'), row('Arroz', 200, 'g', 'arroz')],
    )
    expect(out[0].inStock).toBe(true)
    expect(out[1]).toMatchObject({ inStock: false, haveQuantity: 200, haveSource: 'inStock' })
    expect(missingQuantity(out[1])).toBe(300)
  })

  it('a partial «ya tienes» never says more than the pantry holds', () => {
    const cebolla = line('cebolla', 7, 'u', { haveQuantity: 3, haveSource: 'inStock' })
    expect(withPantryAtHome([cebolla], [row('Cebolla', 1, 'u', 'cebolla')])[0]).toMatchObject({ haveQuantity: 1, inStock: false })
    expect(withPantryAtHome([cebolla], [])[0].haveQuantity).toBeUndefined()
    // What was bought (not «en casa») is not the pantry's business.
    const bought = line('ajo', 8, 'u', { haveQuantity: 3, haveSource: 'checked' })
    expect(withPantryAtHome([bought], [])[0]).toBe(bought)
  })

  it('a row backs the line by catalogue ingredient (also a joined one) or by name', () => {
    const huevos = line('huevo', 10, 'u', { name: 'Huevos', inStock: true, mergedIngredientIds: ['yema'] })
    expect(withPantryAtHome([huevos], [row('Yemas', 12, 'u', 'yema')])[0].inStock).toBe(true)
    expect(withPantryAtHome([huevos], [row('huevos', 12, 'u')])[0].inStock).toBe(true)
    expect(withPantryAtHome([huevos], [row('Huevos de codorniz', 12, 'u')])[0].inStock).toBe(false)
    const muslo = manual('Muslo de pollo', { inStock: true, quantity: 250, unit: 'g' })
    expect(withPantryAtHome([muslo], [row('muslo de pollo', 300, 'g')])[0].inStock).toBe(true)
    expect(withPantryAtHome([muslo], [row('Muslo de pollo', 0, 'g')])[0].inStock).toBe(false)
  })

  it('converts with the catalogue; an amount that does not compare leaves the mark', () => {
    const convert = (_id: string, q: number, from: string, to: string) => (from === 'u' && to === 'g' ? q * 150 : null)
    const cebolla = line('cebolla', 300, 'g', { inStock: true })
    expect(withPantryAtHome([cebolla], [row('Cebolla', 2, 'u', 'cebolla')], convert)[0].inStock).toBe(true)
    expect(withPantryAtHome([cebolla], [row('Cebolla', 1, 'u', 'cebolla')], convert)[0]).toMatchObject({ inStock: false, haveQuantity: 150 })
    expect(withPantryAtHome([cebolla], [row('Cebolla', 1, 'kg', 'cebolla')])[0].inStock).toBe(true)
    expect(withPantryAtHome([cebolla], [row('Cebolla', 2, 'cda', 'cebolla')])[0].inStock).toBe(true)
  })

  it('never marks a line «en casa» by itself', () => {
    const tortillas = line('tortillas', 4)
    expect(withPantryAtHome([tortillas], [row('Tortillas', 10, 'u', 'tortillas')])[0]).toBe(tortillas)
  })

  it('names compare without accents, case or a plural', () => {
    expect(sameName('Calabacines', 'calabacín')).toBe(true)
    expect(sameName('Tortillas de maíz sin gluten', 'tortilla de maiz sin gluten')).toBe(true)
    expect(sameName('Tamari', 'Tamari sin gluten')).toBe(false)
  })
})
