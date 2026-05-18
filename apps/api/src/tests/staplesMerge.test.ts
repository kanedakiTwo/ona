/**
 * Pure-logic tests for `mergeStaplesIntoItems` — the reducer that prepends
 * household staples to a freshly-generated shopping list, dedup'd against
 * what the menu already produced (by case-insensitive name match).
 *
 * Why a pure function: a regression here would either (a) make staples
 * vanish from the list, or (b) cause double-billing (menu generated milk +
 * staple milk = two rows with separate prices). Either is silent in the UI
 * but obvious in unit tests.
 */
import { describe, expect, it } from 'vitest'
import type { ShoppingItem } from '@ona/shared'
import { mergeStaplesIntoItems, type StapleSnapshot } from '../services/shoppingList.js'

function existing(name: string, kind: ShoppingItem['kind'] = 'menu'): ShoppingItem {
  return {
    id: 'i-' + name,
    ingredientId: 'ing-' + name,
    name,
    quantity: 1,
    unit: 'u',
    aisle: 'otros',
    checked: false,
    inStock: false,
    kind,
  }
}

function staple(name: string, qty = 1, price: number | null = null): StapleSnapshot {
  return {
    name,
    quantity: qty,
    unit: 'u',
    aisle: 'lacteos',
    pricePerUnit: price,
  }
}

describe('mergeStaplesIntoItems', () => {
  it('returns the menu list unchanged when there are no staples', () => {
    const items = [existing('arroz'), existing('cebolla')]
    const merged = mergeStaplesIntoItems(items, [])
    expect(merged).toHaveLength(2)
    expect(merged[0].name).toBe('arroz')
  })

  it('prepends every staple as a new kind="staple" item when none match', () => {
    const items = [existing('arroz')]
    const merged = mergeStaplesIntoItems(items, [staple('leche'), staple('pan')])
    expect(merged).toHaveLength(3)
    const stapleRows = merged.filter((i) => i.kind === 'staple')
    expect(stapleRows.map((s) => s.name).sort()).toEqual(['leche', 'pan'])
  })

  it('drops a staple whose name already appears (case-insensitive) in the menu items', () => {
    // The menu generated "Leche" — the user's staple "leche" must not
    // double up. Drop the staple; keep the menu row authoritative.
    const items = [existing('Leche')]
    const merged = mergeStaplesIntoItems(items, [staple('leche'), staple('pan')])
    expect(merged).toHaveLength(2)
    const names = merged.map((i) => i.name.toLowerCase())
    expect(names).toContain('leche')
    expect(names).toContain('pan')
    // The "leche" row is still the menu-kind, not the staple-kind.
    const lecheRow = merged.find((i) => i.name.toLowerCase() === 'leche')!
    expect(lecheRow.kind).toBe('menu')
  })

  it('copies pricePerUnit from the staple to the materialised item', () => {
    const merged = mergeStaplesIntoItems([], [staple('café', 1, 4.95)])
    expect(merged).toHaveLength(1)
    expect(merged[0].pricePerUnit).toBe(4.95)
  })

  it('keeps the existing list when every staple is already covered', () => {
    const items = [existing('Leche'), existing('Pan')]
    const merged = mergeStaplesIntoItems(items, [staple('leche'), staple('pan')])
    expect(merged).toHaveLength(2)
    expect(merged.every((i) => i.kind === 'menu')).toBe(true)
  })
})
