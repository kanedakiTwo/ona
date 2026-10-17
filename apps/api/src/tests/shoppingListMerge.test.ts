/**
 * PRO-177 — the shopping list joins lines that are the same product and puts
 * eggs and tofu in «Lácteos y huevos»; tap water and salt never show up.
 * Before, it joined only by catalogue ingredient: «Huevo 4 u» + «Huevos 6 u»,
 * two olive oils, «Jamón cocido» + «Jamón de york», «Limón» + «Limon» were
 * separate lines, and «Agua 1500 ml» was something to buy.
 */
import { describe, expect, it } from 'vitest'
import type { ShoppingItem } from '@ona/shared'
import { catalogAisleFix, isNotBought, shoppingGroupOf } from '@ona/shared'
import { aggregateScaledRows, type CatalogRow, type ScaledRow } from '../services/shoppingList.js'
import { carryItemState } from '../services/shoppingItemState.js'
import { planCatalogAisleFixes } from '../services/catalogIngredientAisles.js'

const cat = (id: string, name: string, extra: Partial<CatalogRow> = {}): CatalogRow => ({
  id,
  name,
  aisle: 'despensa',
  density: null,
  unitWeight: null,
  ...extra,
})

function aggregate(rows: Array<[CatalogRow, number, ScaledRow['unit']]>): ShoppingItem[] {
  const catalog = new Map<string, CatalogRow>()
  const scaled: ScaledRow[] = []
  for (const [c, quantity, unit] of rows) {
    catalog.set(c.id, c)
    scaled.push({ ingredientId: c.id, quantity, unit })
  }
  return aggregateScaledRows(scaled, catalog)
}

const huevo = cat('id-huevo', 'Huevo', { aisle: 'proteinas', unitWeight: 50 })
const huevos = cat('id-huevos', 'Huevos', { aisle: 'proteinas', unitWeight: 50 })
const yema = cat('id-yema', 'Yema de huevo', { aisle: 'proteinas' })

describe('aggregateScaledRows — same product, one line (PRO-177)', () => {
  it('«Huevo 4 u» + «Huevos 6 u» = one line of 10 in «Lácteos y huevos»', () => {
    const items = aggregate([
      [huevo, 4, 'u'],
      [huevos, 6, 'u'],
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ quantity: 10, unit: 'u', aisle: 'lacteos', ingredientId: 'id-huevo' })
    expect(items[0].mergedIngredientIds).toEqual(['id-huevos'])
  })

  it('yolks join the eggs too, and eggs alone go to «Lácteos y huevos»', () => {
    const items = aggregate([
      [huevo, 2, 'u'],
      [yema, 2, 'u'],
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ quantity: 4, unit: 'u', aisle: 'lacteos' })
    expect(aggregate([[yema, 1, 'u']])[0].aisle).toBe('lacteos')
  })

  it('tofu goes to «Lácteos y huevos», not «Carnes y pescados»', () => {
    const items = aggregate([[cat('id-tofu', 'Tofu', { aisle: 'proteinas' }), 200, 'g']])
    expect(items[0].aisle).toBe('lacteos')
  })

  it('two olive oils (one in ml, one in g) are one line', () => {
    const items = aggregate([
      [cat('id-aov', 'Aceite de oliva virgen', { density: 0.92 }), 100, 'ml'],
      [cat('id-aove', 'Aceite de oliva virgen extra'), 46, 'g'],
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ unit: 'g', quantity: 150, name: 'aceite de oliva virgen extra' })
  })

  it('«Jamón cocido» + «Jamón de york» = one line', () => {
    const items = aggregate([
      [cat('id-jc', 'Jamón cocido', { aisle: 'proteinas' }), 100, 'g'],
      [cat('id-jy', 'Jamón de york', { aisle: 'proteinas' }), 50, 'g'],
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ quantity: 150, unit: 'g' })
  })

  it('«Limón» + «Limon» = one line', () => {
    const items = aggregate([
      [cat('id-limon1', 'Limón', { aisle: 'produce', unitWeight: 120 }), 1, 'u'],
      [cat('id-limon2', 'Limon', { aisle: 'produce' }), 2, 'u'],
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ quantity: 3, unit: 'u' })
  })

  it('a duplicated «Pimentón dulce» in teaspoons sums: 1 cdita + 3 cdita = 4 cdita', () => {
    const items = aggregate([
      [cat('id-p1', 'Pimentón dulce'), 1, 'cdita'],
      [cat('id-p2', 'pimentón dulce '), 3, 'cdita'],
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ quantity: 4, unit: 'cdita' })
  })

  it('«Salmón» + «Lomo de salmón sin piel» = one line', () => {
    const items = aggregate([
      [cat('id-s1', 'Salmón', { aisle: 'proteinas' }), 200, 'g'],
      [cat('id-s2', 'Lomo de salmón sin piel', { aisle: 'proteinas' }), 250, 'g'],
    ])
    expect(items).toHaveLength(1)
    expect(items[0].quantity).toBe(450)
  })

  it('different products stay apart: spices, coconut oil, breadcrumbs, lombarda, tomato kinds', () => {
    const items = aggregate([
      [cat('a', 'Pimentón dulce'), 1, 'cdita'],
      [cat('b', 'Comino'), 1, 'cdita'],
      [cat('c', 'Aceite de oliva virgen extra'), 50, 'g'],
      [cat('d', 'Aceite de coco'), 50, 'g'],
      [cat('e', 'Pan blanco'), 100, 'g'],
      [cat('f', 'Pan rallado'), 50, 'g'],
      [cat('g', 'Repollo', { aisle: 'produce' }), 500, 'g'],
      [cat('h', 'Lombarda', { aisle: 'produce' }), 500, 'g'],
      [cat('i', 'Tomate pera', { aisle: 'produce' }), 200, 'g'],
      [cat('j', 'Tomate de rama', { aisle: 'produce' }), 200, 'g'],
    ])
    expect(items).toHaveLength(10)
  })

  it('tap water and salt never become lines; «agua de coco» does', () => {
    const items = aggregate([
      [cat('w', 'Agua'), 1500, 'ml'],
      [cat('w2', 'Agua del grifo'), 650, 'ml'],
      [cat('s', 'Sal'), 2000, 'g'],
      [cat('c', 'Agua de coco'), 500, 'ml'],
    ])
    expect(items.map((i) => i.name)).toEqual(['agua de coco'])
    expect(isNotBought('Agua')).toBe(true)
    expect(isNotBought('agua con gas')).toBe(false)
  })
})

describe('what was marked survives the join (PRO-177)', () => {
  it('a line marked «comprado» before the join stays marked after it', () => {
    // Yesterday: two lines, «huevos 6 u» ticked as bought.
    const before: ShoppingItem[] = [
      { id: 'menu:id-huevo:u', ingredientId: 'id-huevo', name: 'huevo', quantity: 4, unit: 'u', aisle: 'proteinas', checked: false, inStock: false },
      { id: 'menu:id-huevos:u', ingredientId: 'id-huevos', name: 'huevos', quantity: 6, unit: 'u', aisle: 'proteinas', checked: true, inStock: false },
    ]
    // Today the aggregator joins them into one line keyed on «huevo».
    const after = aggregate([
      [huevo, 4, 'u'],
      [huevos, 6, 'u'],
    ])
    expect(after).toHaveLength(1)
    const { items } = carryItemState(after, before, null)
    expect(items[0]).toMatchObject({ ingredientId: 'id-huevo', quantity: 10, checked: true })
  })

  it('«ya en casa» from the remembered state carries over too', () => {
    const after = aggregate([
      [huevo, 4, 'u'],
      [huevos, 6, 'u'],
    ])
    const { items } = carryItemState(after, [], { 'id-huevos|u': { checked: false, inStock: true, pricePerUnit: null } })
    expect(items[0].inStock).toBe(true)
  })
})

describe('shoppingGroupOf', () => {
  it('groups by rule and preset choice', () => {
    expect(shoppingGroupOf('Huevo').key).toBe(shoppingGroupOf('Yema de huevo').key)
    expect(shoppingGroupOf('Jamón cocido').key).toBe(shoppingGroupOf('jamon de york').key)
    expect(shoppingGroupOf('Jamón serrano').key).not.toBe(shoppingGroupOf('Jamón ibérico').key)
    expect(shoppingGroupOf('Aceite de oliva').key).not.toBe(shoppingGroupOf('Aceite de girasol').key)
  })
})

describe('catalogue aisle fix (PRO-177 data fix)', () => {
  it('moves only exact egg / tofu names still under proteinas', () => {
    expect(catalogAisleFix('huevo', 'proteinas')).toBe('lacteos')
    expect(catalogAisleFix('Yema de huevo', 'proteinas')).toBe('lacteos')
    expect(catalogAisleFix('clara', 'proteinas')).toBe('lacteos')
    expect(catalogAisleFix('tofu', 'proteinas')).toBe('lacteos')
    expect(catalogAisleFix('huevo', 'lacteos')).toBeNull() // already right: idempotent
    expect(catalogAisleFix('huevo', 'otros')).toBeNull() // a curator's choice stays
    expect(catalogAisleFix('pollo', 'proteinas')).toBeNull()
    expect(catalogAisleFix('salsa de huevo', 'proteinas')).toBeNull()
  })

  it('plans the update for the rows that need it', () => {
    const plan = planCatalogAisleFixes([
      { id: '1', name: 'huevo', aisle: 'proteinas' },
      { id: '2', name: 'tofu', aisle: 'proteinas' },
      { id: '3', name: 'merluza', aisle: 'proteinas' },
      { id: '4', name: 'yema', aisle: 'lacteos' },
    ])
    expect(plan.map((p) => p.id)).toEqual(['1', '2'])
  })
})
