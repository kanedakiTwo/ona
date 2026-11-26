/**
 * PRO-1265: «Ya en casa» is the pantry, so what the list says is at home
 * (the «En casa» button, «¿Cuánto os queda en casa?») is written there; the
 * next rebuild would otherwise send the line back to «Por comprar».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pantry: any[] = []
vi.mock('../services/pantryStore.js', () => ({
  NoHouseholdError: class NoHouseholdError extends Error {},
  listPantryForUser: vi.fn(async () => pantry.slice()),
  addPantryForUser: vi.fn(async (_u: string, input: any) => {
    const row = { id: `p-${pantry.length + 1}`, ingredientId: null, ...input }
    pantry.push(row)
    return row
  }),
  deletePantryForUser: vi.fn(async (_u: string, id: string) => {
    const i = pantry.findIndex((p) => p.id === id)
    if (i >= 0) pantry.splice(i, 1)
    return i >= 0
  }),
  patchPantryForUser: vi.fn(async (_u: string, id: string, patch: any) => {
    const row = pantry.find((p) => p.id === id)
    if (row) Object.assign(row, patch)
    return row ?? null
  }),
}))

import type { ShoppingItem } from '@ona/shared'
import { setPantryAmountForLine, syncPantryForLine } from '../services/shoppingPantrySync.js'
import { withPantryAtHome } from '../services/shoppingPantry.js'

const aceite = (extra: Partial<ShoppingItem> = {}) =>
  ({ id: 'menu:ace:ml', ingredientId: 'ace', name: 'Aceite de oliva virgen', quantity: 500, unit: 'ml', aisle: 'despensa', checked: false, inStock: false, kind: 'menu', ...extra }) as ShoppingItem

describe('the list writes the pantry (PRO-1265)', () => {
  beforeEach(() => {
    pantry.length = 0
  })

  it('«nos quedan 100 ml» → the pantry holds 100 ml and the rebuild keeps «Te faltan 400»', async () => {
    pantry.push({ id: 'p-0', ingredientId: 'ace', name: 'Aceite', quantity: 2, unit: 'l' })
    await setPantryAmountForLine('u-1', aceite(), 100)
    expect(pantry).toEqual([expect.objectContaining({ id: 'p-0', quantity: 100, unit: 'ml' })])
    const rebuilt = withPantryAtHome([aceite({ haveQuantity: 100, haveSource: 'inStock' })], pantry)
    expect(rebuilt[0]).toMatchObject({ haveQuantity: 100, inStock: false })
    await setPantryAmountForLine('u-1', aceite(), 0)
    expect(pantry).toEqual([])
  })

  it('«En casa» puts the line amount in; «Quitar» takes it out', async () => {
    await syncPantryForLine('u-1', aceite(), true)
    expect(pantry).toEqual([expect.objectContaining({ ingredientId: 'ace', quantity: 500, unit: 'ml' })])
    expect(withPantryAtHome([aceite({ inStock: true })], pantry)[0].inStock).toBe(true)
    await syncPantryForLine('u-1', aceite(), false)
    expect(pantry).toEqual([])
  })

  it('a row with more is left alone; one with less is raised to the line', async () => {
    pantry.push({ id: 'p-0', ingredientId: 'ace', name: 'Aceite', quantity: 750, unit: 'ml' })
    await syncPantryForLine('u-1', aceite(), true)
    expect(pantry[0].quantity).toBe(750)
    pantry[0].quantity = 100
    await syncPantryForLine('u-1', aceite(), true)
    expect(pantry[0].quantity).toBe(500)
  })
})
