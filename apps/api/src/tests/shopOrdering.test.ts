/**
 * Ordering shops inside their kind (PRO-287): Miguel wanted Mercadona as
 * his first súper, ahead of El Corte Inglés, and had to delete El Corte
 * Inglés because /compra/tiendas had no way to reorder. The first shop of a
 * kind gets that kind's order (`pickShopForKind`), so «Subir», «Bajar» and
 * Mimo's «pon X la primera» only swap shops of the same kind.
 *
 * Run: pnpm --filter @ona/api test src/tests/shopOrdering.test.ts
 */
import { describe, it, expect } from 'vitest'
import { reorderShopIds } from '../services/shopOrders/store.js'
import { pickShopForKind } from '../services/shopOrders/classify.js'

const SHOPS = [
  { id: 'eci', kind: 'supermercado' },
  { id: 'fruta', kind: 'fruteria' },
  { id: 'carrefour', kind: 'supermercado' },
  { id: 'mercadona', kind: 'supermercado' },
  { id: 'carne', kind: 'carniceria' },
]

describe('reorderShopIds', () => {
  it('moves a súper up past the previous súper, leaving other kinds in their slots', () => {
    expect(reorderShopIds(SHOPS, 'carrefour', 'up')).toEqual(['carrefour', 'fruta', 'eci', 'mercadona', 'carne'])
  })
  it('moves a súper down past the next súper', () => {
    expect(reorderShopIds(SHOPS, 'eci', 'down')).toEqual(['carrefour', 'fruta', 'eci', 'mercadona', 'carne'])
  })
  it('first puts it before every other shop of its kind', () => {
    expect(reorderShopIds(SHOPS, 'mercadona', 'first')).toEqual(['mercadona', 'fruta', 'eci', 'carrefour', 'carne'])
  })
  it('does nothing at the edges or for a shop alone in its kind', () => {
    const same = SHOPS.map((s) => s.id)
    expect(reorderShopIds(SHOPS, 'eci', 'up')).toEqual(same)
    expect(reorderShopIds(SHOPS, 'mercadona', 'down')).toEqual(same)
    expect(reorderShopIds(SHOPS, 'fruta', 'down')).toEqual(same)
  })
  it('null for a shop that is not the household’s', () => {
    expect(reorderShopIds(SHOPS, 'otra', 'up')).toBeNull()
  })
  it('the súper order then goes to the new first súper', () => {
    const ids = reorderShopIds(SHOPS, 'mercadona', 'first')!
    const shops = ids.map((id, position) => ({ ...SHOPS.find((s) => s.id === id)!, position })) as Array<{ id: string; kind: 'supermercado'; position: number }>
    expect(pickShopForKind('supermercado', shops)?.id).toBe('mercadona')
  })
})
