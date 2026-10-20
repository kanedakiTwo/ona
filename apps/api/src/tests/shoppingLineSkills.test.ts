/**
 * PRO-292 (D-051): Mimo switches the unit of a line of the shopping list —
 * «de cebolla pon 3 unidades», «la cebolla otra vez en gramos» — with the
 * same REST call /shopping makes. A fake AppApi records the calls.
 */
import { describe, expect, it } from 'vitest'
import { shoppingLineSkills } from '../services/assistant/shoppingLineSkills.js'
import { shopOrderSkills } from '../services/assistant/shopOrderSkills.js'
import { AppApiError, type AppApi } from '../services/assistant/appApi.js'

const get = (name: string) => {
  const s = shoppingLineSkills.find((x) => x.name === name)
  if (!s) throw new Error(`skill ${name} missing`)
  return s
}

const LIST = {
  id: 'L1',
  items: [
    { id: 'menu:ceb:g', ingredientId: 'ceb', name: 'cebolla', quantity: 700, unit: 'g', kind: 'menu', unitOptions: ['g', 'u'] },
    { id: 'menu:per:g', ingredientId: 'per', name: 'perejil', quantity: 25, unit: 'g', kind: 'menu', unitOptions: ['g'] },
    { id: 'm1', ingredientId: null, name: 'Galletas', quantity: 2, unit: 'u', kind: 'manual', amountText: '2 paquetes' },
    { id: 'staple:pan', ingredientId: null, name: 'Pan', quantity: 1, unit: 'u', kind: 'staple' },
  ],
}

function fakeApi(routes: Record<string, unknown | ((body: any) => unknown)>) {
  const calls: { method: string; path: string; body?: any }[] = []
  const api: AppApi = async (method, path, body) => {
    calls.push({ method, path, body })
    const value = routes[`${method} ${path}`]
    if (value instanceof Error) throw value
    return (typeof value === 'function' ? (value as any)(body) : (value ?? {})) as any
  }
  return { api, calls }
}
const ctx = (api: AppApi) => ({ userId: 'u1', db: null as any, api })
const writes = (calls: { method: string }[]) => calls.filter((c) => c.method !== 'GET')

describe('change_shopping_item_unit (PRO-292)', () => {
  it('is registered with the rest of the tools', () => {
    expect(shopOrderSkills.map((s) => s.name)).toContain('change_shopping_item_unit')
  })

  it('«de cebolla pon 3 unidades» switches a menu line to units with that amount', async () => {
    const f = fakeApi({
      'GET /shopping-list': LIST,
      'PUT /shopping-list/L1/item/menu%3Aceb%3Ag/edit': {
        id: 'L1',
        items: [{ id: 'menu:ceb:g', name: 'cebolla', quantity: 3, unit: 'u', menuUnit: 'g', menuQuantity: 700 }],
      },
    })
    const r = await get('change_shopping_item_unit').handler({ name: 'cebolla', unit: 'unidades', quantity: 3 }, ctx(f.api))
    expect(writes(f.calls)).toEqual([{ method: 'PUT', path: '/shopping-list/L1/item/menu%3Aceb%3Ag/edit', body: { unit: 'u', quantity: 3 } }])
    expect(r.summary).toMatch(/^Hecho: Cebolla, 3/)
    expect(r.summary).toContain('el menú pedía 700 g')
    expect(r.uiHint).toBe('shopping_list')
  })

  it('«la cebolla en gramos» without an amount goes back to what the menu asks', async () => {
    const f = fakeApi({ 'GET /shopping-list': LIST, 'PUT /shopping-list/L1/item/menu%3Aceb%3Ag/edit': { id: 'L1', items: [{ id: 'menu:ceb:g', name: 'cebolla', quantity: 700, unit: 'g' }] } })
    const r = await get('change_shopping_item_unit').handler({ name: 'la cebolla', unit: 'gramos' }, ctx(f.api))
    expect(writes(f.calls)).toEqual([{ method: 'PUT', path: '/shopping-list/L1/item/menu%3Aceb%3Ag/edit', body: { unit: 'g' } }])
    expect(r.summary).toContain('Cebolla, 700 g')
  })

  it('kilos are grams × 1000', async () => {
    const f = fakeApi({ 'GET /shopping-list': LIST })
    await get('change_shopping_item_unit').handler({ name: 'cebolla', unit: 'kilos', quantity: 1.5 }, ctx(f.api))
    expect(writes(f.calls)[0].body).toEqual({ unit: 'g', quantity: 1500 })
  })

  it('says so, and changes nothing, when the product does not convert', async () => {
    const f = fakeApi({ 'GET /shopping-list': LIST })
    const r = await get('change_shopping_item_unit').handler({ name: 'perejil', unit: 'unidades' }, ctx(f.api))
    expect(writes(f.calls)).toEqual([])
    expect(r.summary).toContain('no se puede pasar a unidades')
    expect(r.summary).toContain('Se compra en gramos')
  })

  it('relays the API refusal instead of failing', async () => {
    const f = fakeApi({ 'GET /shopping-list': LIST, 'PUT /shopping-list/L1/item/menu%3Aceb%3Ag/edit': new AppApiError(400, 'cebolla no se puede pasar a mililitros') })
    const r = await get('change_shopping_item_unit').handler({ name: 'cebolla', unit: 'u' }, ctx(f.api))
    expect(r.summary).toContain('No he cambiado nada')
  })

  it('a line typed by hand takes any unit; a staple points to Mis básicos; an unknown product changes nothing', async () => {
    const f = fakeApi({ 'GET /shopping-list': LIST })
    await get('change_shopping_item_unit').handler({ name: 'galletas', unit: 'gramos', quantity: 500 }, ctx(f.api))
    const staple = await get('change_shopping_item_unit').handler({ name: 'pan', unit: 'gramos' }, ctx(f.api))
    const missing = await get('change_shopping_item_unit').handler({ name: 'caviar', unit: 'gramos' }, ctx(f.api))
    expect(writes(f.calls)).toEqual([{ method: 'PATCH', path: '/shopping-list/L1/item/m1', body: { unit: 'g', quantity: 500, amountText: null } }])
    expect(staple.summary).toContain('básicos')
    expect(missing.summary).toContain('no está en la lista')
  })
})
