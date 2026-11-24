/**
 * PRO-1092 — a line typed by hand (or by Mimo) that is the same product as a
 * line of the menu joins it. Hogares de prueba (2026-11-01 → 11-24):
 * «Espinacas · LA QUE VIENE» and «Espinacas · MANUAL», «Jamón de york» and
 * «Jamón cocido · MANUAL», «Levadura química (1 sobre) · MANUAL» next to
 * «Levadura quimica» and «Levadura», «Leche entera» and «Leche · MANUAL»;
 * the pescadilla and the pescado blanco in «Otros».
 */
import { describe, expect, it } from 'vitest'
import { sameListProduct, type ShoppingItem } from '@ona/shared'
import { foldManualIntoMenu, manualLinesOf } from '../services/shoppingManualFold.js'
import { aggregateScaledRows, type CatalogRow, type ScaledRow } from '../services/shoppingList.js'

const menu = (name: string, quantity: number, unit: ShoppingItem['unit'], extra: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id: `menu:id-${name}:${unit}`,
  ingredientId: `id-${name}`,
  name,
  quantity,
  unit,
  aisle: 'otros',
  checked: false,
  inStock: false,
  ...extra,
})
const manual = (name: string, extra: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id: `uuid-${name}`,
  ingredientId: null,
  name,
  quantity: 1,
  unit: 'u',
  aisle: 'otros',
  checked: false,
  inStock: false,
  kind: 'manual',
  quantitySource: 'default',
  ...extra,
})
const fresh = (...items: ShoppingItem[]) => items.map((item) => ({ item, joined: false }))

describe('sameListProduct (PRO-1092)', () => {
  it('joins what the households saw twice', () => {
    expect(sameListProduct('Jamón cocido', 'jamón de york')).toBe(true)
    expect(sameListProduct('Hueso de pollo', 'huesos de pollo')).toBe(true)
    expect(sameListProduct('Levadura química (1 sobre)', 'levadura')).toBe(true)
    expect(sameListProduct('Levadura quimica', 'Levadura')).toBe(true)
    expect(sameListProduct('Leche', 'leche entera')).toBe(true)
    expect(sameListProduct('Huevos', 'huevo')).toBe(true)
    expect(sameListProduct('Tofu', 'tofu firme')).toBe(true)
    expect(sameListProduct('Yogur griego', 'yogur griego')).toBe(true)
  })
  it('never two products', () => {
    expect(sameListProduct('Pan', 'pan rallado')).toBe(false)
    expect(sameListProduct('Leche desnatada', 'leche entera')).toBe(false)
    expect(sameListProduct('Queso', 'queso en lonchas')).toBe(false)
    expect(sameListProduct('Jamón serrano', 'jamón cocido')).toBe(false)
    expect(sameListProduct('Aceite de coco', 'aceite de oliva virgen extra')).toBe(false)
  })
})

describe('foldManualIntoMenu (PRO-1092)', () => {
  it('a hand line with no amount joins the menu line and adds nothing', () => {
    const { items, manual: alone } = foldManualIntoMenu([menu('espinacas', 300, 'g')], fresh(manual('Espinacas')))
    expect(alone).toEqual([])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: 'espinacas', quantity: 300, unit: 'g' })
    expect(items[0]!.manualParts?.map((p) => p.name)).toEqual(['Espinacas'])
    expect(items[0]!.manualAmount).toBeUndefined()
  })

  it('an amount in the same unit or one that converts is added up', () => {
    const toMl = (_id: string, q: number, from: ShoppingItem['unit'], to: ShoppingItem['unit']) => (from === to ? q : null)
    const { items } = foldManualIntoMenu(
      [menu('jamón de york', 150, 'g'), menu('leche entera', 250, 'ml')],
      fresh(manual('Jamón cocido', { quantity: 200, unit: 'g', quantitySource: 'user' }), manual('Leche', { quantity: 2000, unit: 'ml', quantitySource: 'user' })),
      toMl,
    )
    expect(items[0]).toMatchObject({ quantity: 350, manualAmount: '200 g' })
    expect(items[1]).toMatchObject({ quantity: 2250, manualAmount: '2 l' })
  })

  it('«1 sobre» or a unit that does not convert goes on top, said apart', () => {
    const { items } = foldManualIntoMenu(
      [menu('levadura', 16, 'g'), menu('tofu', 300, 'g')],
      fresh(manual('Levadura química (1 sobre)'), manual('Tofu', { quantity: 2, unit: 'u', quantitySource: 'user' })),
    )
    expect(items[0]).toMatchObject({ quantity: 16, manualParts: [expect.objectContaining({ name: 'Levadura química (1 sobre)' })] })
    expect(items[1]).toMatchObject({ quantity: 300, manualExtra: '2 unidades' })
    const sobre = foldManualIntoMenu([menu('levadura', 16, 'g')], fresh(manual('Levadura', { amountText: '1 sobre', quantitySource: 'user' })))
    expect(sobre.items[0]!.manualExtra).toBe('1 sobre')
  })

  it('the household\'s own amount stays theirs; the menu\'s grows', () => {
    const { items } = foldManualIntoMenu(
      [menu('leche entera', 2000, 'ml', { menuQuantity: 250 })],
      fresh(manual('Leche', { quantity: 1000, unit: 'ml', quantitySource: 'user' })),
    )
    expect(items[0]).toMatchObject({ quantity: 2000, menuQuantity: 1250 })
  })

  it('more of a product already ticked, or of one left out, keeps its own line', () => {
    const ticked = foldManualIntoMenu([menu('leche entera', 1000, 'ml', { checked: true })], fresh(manual('Leche')))
    expect(ticked.manual.map((m) => m.name)).toEqual(['Leche'])
    expect(ticked.items[0]!.manualParts).toBeUndefined()
    const skipped = foldManualIntoMenu([menu('espinacas', 300, 'g', { skipped: true })], fresh(manual('Espinacas')))
    expect(skipped.manual).toHaveLength(1)
  })

  it('once joined, a hand line follows the line: ticked, saved and rebuilt, and back on its own without the menu', () => {
    const first = foldManualIntoMenu([menu('hueso de pollo', 500, 'g')], fresh(manual('Hueso de pollo')))
    // The household ticks the joined line (the check route writes the row).
    const saved = first.items.map((it) => ({ ...it, checked: true }))
    const again = foldManualIntoMenu([menu('hueso de pollo', 500, 'g', { checked: true })], manualLinesOf(saved))
    expect(again.manual).toEqual([])
    expect(again.items[0]!.manualParts).toEqual([expect.objectContaining({ name: 'Hueso de pollo', checked: true })])
    // The dish leaves the menu: the hand line comes back on its own, bought.
    const gone = foldManualIntoMenu([], manualLinesOf(again.items))
    expect(gone.manual).toEqual([expect.objectContaining({ name: 'Hueso de pollo', kind: 'manual', checked: true })])
  })

  it('a hand line of another product is left alone', () => {
    const { items, manual: alone } = foldManualIntoMenu([menu('pan rallado', 100, 'g')], fresh(manual('Pan')))
    expect(alone.map((m) => m.name)).toEqual(['Pan'])
    expect(items[0]!.manualParts).toBeUndefined()
  })
})

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

describe('aggregateScaledRows (PRO-1092)', () => {
  it('«Levadura» and «Levadura quimica» are one line', () => {
    const items = aggregate([
      [cat('a', 'Levadura'), 8, 'g'],
      [cat('b', 'Levadura quimica'), 16, 'g'],
    ])
    expect(items).toHaveLength(1)
    expect(items[0]!.quantity).toBe(25)
  })

  it('the pescadilla and the pescado blanco go to «Carnes y pescados» when the catalogue says «Otros»', () => {
    const items = aggregate([
      [cat('p', 'Pescadilla', { aisle: 'otros' }), 400, 'g'],
      [cat('b', 'Pescado blanco', { aisle: null as unknown as CatalogRow['aisle'] }), 300, 'g'],
      [cat('m', 'Merluza congelada', { aisle: 'congelados' }), 400, 'g'],
    ])
    const aisle = (n: string) => items.find((i) => i.name.toLowerCase().startsWith(n))?.aisle
    expect(aisle('pescadilla')).toBe('proteinas')
    expect(aisle('pescado blanco')).toBe('proteinas')
    expect(aisle('merluza congelada')).toBe('congelados')
  })
})
