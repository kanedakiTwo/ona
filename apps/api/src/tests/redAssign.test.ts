/**
 * Red de tiendas: which shop each fresh kind goes to (design §5, question 0 → a).
 *
 * Run: pnpm --filter @ona/api test src/tests/redAssign.test.ts
 */
import { describe, it, expect } from 'vitest'
import type { ShoppingItem } from '@ona/shared'
import { planRedAssignments, redCandidates, type PlanInput, type RedShopLite } from '../services/red/assign.js'
import { pickShopForKind } from '../services/shopOrders/classify.js'
import { draftOrdersFromItems } from '../services/shopOrders/draft.js'

const red = (over: Partial<RedShopLite> = {}): RedShopLite => ({
  id: 'r1', name: 'Frutería de prueba', kind: 'fruteria', postalCode: '28001', deliveryPostalCodes: [], status: 'activa',
  joinedAt: new Date('2026-11-01T10:00:00Z'), ...over,
})
const base: PlanInput = {
  neededKinds: ['fruteria'], hasSuper: false, superName: null, postalCode: '28001', choices: {}, redShops: [red()], halal: false, hasAllergies: false,
}

describe('redCandidates', () => {
  it('same postal code first, then the one that delivers there, then the oldest in the Red', () => {
    const shops = [
      red({ id: 'far', postalCode: '28002', deliveryPostalCodes: ['28001'], joinedAt: new Date('2026-10-01') }),
      red({ id: 'sameNoDelivery', joinedAt: new Date('2026-11-02') }),
      red({ id: 'sameDelivers', deliveryPostalCodes: ['28001'], joinedAt: new Date('2026-11-03') }),
      red({ id: 'sameOld', joinedAt: new Date('2026-09-01') }),
    ]
    expect(redCandidates('fruteria', '28001', shops).map((s) => s.id)).toEqual(['sameDelivers', 'sameOld', 'sameNoDelivery', 'far'])
  })
  it('leaves out paused shops, other kinds and shops that are not in nor deliver to that postal code', () => {
    const shops = [red({ id: 'a', status: 'pausada' }), red({ id: 'b', kind: 'carniceria' }), red({ id: 'c', postalCode: '28005' }), red({ id: 'd' })]
    expect(redCandidates('fruteria', '28001', shops).map((s) => s.id)).toEqual(['d'])
  })
})

describe('planRedAssignments', () => {
  it('no shop of that kind and no súper: assigns the best one, the rest as alternatives', () => {
    const p = planRedAssignments({ ...base, redShops: [red({ id: 'r2', joinedAt: new Date('2026-11-03') }), red()] })
    expect(p.assign.map((a) => [a.kind, a.redShop.id, a.alternatives.map((s) => s.id)])).toEqual([['fruteria', 'r1', ['r2']]])
    expect(p.ask).toEqual([])
  })
  it('with a súper: asks once instead of assigning', () => {
    const p = planRedAssignments({ ...base, hasSuper: true, superName: 'Súper del barrio' })
    expect(p.ask.map((a) => [a.kind, a.redShop.id])).toEqual([['fruteria', 'r1']])
    expect(p.assign).toEqual([])
  })
  it('the household said «al súper»: nothing', () => {
    const p = planRedAssignments({ ...base, hasSuper: true, choices: { fruteria: 'super' } })
    expect(p).toEqual({ needsPostalCode: false, assign: [], ask: [], heldBack: [], uncovered: [] })
  })
  it('without a postal code: asks for it and assigns nothing', () => {
    const p = planRedAssignments({ ...base, postalCode: null })
    expect(p.needsPostalCode).toBe(true)
    expect(p.assign).toEqual([])
  })
  it('no Red shop for that postal code: uncovered', () => {
    expect(planRedAssignments({ ...base, redShops: [] }).uncovered).toEqual(['fruteria'])
  })
  it('halal: never a carnicería on its own; allergies: neither carnicería nor pescadería', () => {
    const shops = [red(), red({ id: 'c1', kind: 'carniceria' }), red({ id: 'p1', kind: 'pescaderia' })]
    const all = { ...base, neededKinds: ['fruteria', 'carniceria', 'pescaderia'] as PlanInput['neededKinds'], redShops: shops }
    const halal = planRedAssignments({ ...all, halal: true })
    expect(halal.assign.map((a) => a.kind)).toEqual(['fruteria', 'pescaderia'])
    expect(halal.heldBack.map((h) => [h.kind, h.reason, h.candidates.map((c) => c.id)])).toEqual([['carniceria', 'halal', ['c1']]])
    const allergies = planRedAssignments({ ...all, hasAllergies: true })
    expect(allergies.assign.map((a) => a.kind)).toEqual(['fruteria'])
    expect(allergies.heldBack.map((h) => [h.kind, h.reason])).toEqual([['carniceria', 'alergias'], ['pescaderia', 'alergias']])
  })
  it('nothing needed: nothing to do, not even the postal code', () => {
    expect(planRedAssignments({ ...base, neededKinds: [], postalCode: null }).needsPostalCode).toBe(false)
  })
})

describe('the household’s own shop first', () => {
  it('pickShopForKind prefers its own shop over a Red copy of the same kind', () => {
    const shops = [
      { id: 'redCopy', kind: 'fruteria' as const, position: 0, origin: 'red' },
      { id: 'own', kind: 'fruteria' as const, position: 1, origin: 'propia' },
    ]
    expect(pickShopForKind('fruteria', shops)?.id).toBe('own')
  })
})

describe('draftOrdersFromItems → fellBack', () => {
  const item = (name: string, aisle: ShoppingItem['aisle']): ShoppingItem => ({
    id: `manual:${name}`, ingredientId: null, name, quantity: 1000, unit: 'g', aisle, checked: false, inStock: false, kind: 'manual', quantitySource: 'user',
  })
  it('names the kinds whose lines went to the súper or nowhere', () => {
    const r = draftOrdersFromItems([item('manzanas', 'produce'), item('merluza', 'proteinas')], [{ id: 's', kind: 'supermercado', position: 0, priceMemory: {} }])
    expect([...r.fellBack].sort()).toEqual(['fruteria', 'pescaderia'])
  })
  it('a kind with its own shop did not fall back', () => {
    const r = draftOrdersFromItems([item('manzanas', 'produce')], [{ id: 'f', kind: 'fruteria', position: 0, priceMemory: {} }])
    expect(r.fellBack).toEqual([])
  })
})
