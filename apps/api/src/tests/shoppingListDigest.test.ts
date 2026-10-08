/**
 * The shopping list summary WhatsApp appends when the user asks for it
 * (Miguel, 2026-10-08: "lo mismo con la compra" — read and iterate in the chat).
 */
import { describe, it, expect } from 'vitest'
import { shoppingListDigest, shoppingQuantity, isShoppingItemList, SHOPPING_DIGEST_INVITE } from '../services/shoppingText.js'

const item = (name: string, aisle: string, quantity: number, unit: string, extra: Record<string, unknown> = {}) =>
  ({ id: name, ingredientId: null, name, quantity, unit, aisle, checked: false, inStock: false, ...extra }) as any

describe('shoppingQuantity', () => {
  it('reads like the app', () => {
    expect(shoppingQuantity(1500, 'g')).toBe('1.5 kg')
    expect(shoppingQuantity(300, 'g')).toBe('300 g')
    expect(shoppingQuantity(2000, 'ml')).toBe('2 L')
    expect(shoppingQuantity(6, 'u')).toBe('6')
    expect(shoppingQuantity(2, 'cdita')).toBe('2 cdita')
  })
})

describe('shoppingListDigest', () => {
  const items = [
    item('Pan', 'panaderia', 1, 'u'),
    item('Cebolla', 'produce', 300, 'g'),
    item('Dorada', 'proteinas', 2, 'u'),
    item('Calabaza', 'produce', 1200, 'g'),
    item('Leche', 'lacteos', 1000, 'ml', { checked: true }),
    item('Aceite de oliva', 'despensa', 50, 'ml', { inStock: true }),
  ]
  const text = shoppingListDigest(items)
  const lines = text.split('\n')

  it('counts only what is left to buy', () => {
    expect(lines[0]).toBe('*Tu lista de la compra* · 4 cosas')
  })
  it('groups by aisle in the app order with quantities', () => {
    expect(lines[1]).toBe('*Frutas y verduras:* Cebolla (300 g), Calabaza (1.2 kg)')
    expect(lines[2]).toBe('*Carnes y pescados:* Dorada (2)')
    expect(lines[3]).toBe('*Panadería:* Pan (1)')
  })
  it('leaves ticked items out and lists what is at home apart', () => {
    expect(text).not.toContain('Leche')
    expect(lines).toContain('Ya tienes en casa: Aceite de oliva')
    expect(lines.at(-1)).toBe(SHOPPING_DIGEST_INVITE)
  })
  it('says so when nothing is left to buy', () => {
    expect(shoppingListDigest([item('Leche', 'lacteos', 1, 'u', { checked: true })])).toMatch(/No te falta nada/)
    expect(shoppingListDigest([])).toMatch(/vacía/)
  })
  it('recognises a list of shopping items (and nothing else)', () => {
    expect(isShoppingItemList(items)).toBe(true)
    expect(isShoppingItemList({ listId: 'x' })).toBe(false)
    expect(isShoppingItemList([{ id: 'm1', days: [] }])).toBe(false)
  })
})
