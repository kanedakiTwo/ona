/**
 * Preparing the orders with the buy rules (specs/shop-orders.md): Miguel's
 * real list (2026-10-08) goes through the draft, duplicates merge, compounds
 * split, pantry staples stay home, and the order is blocked until a choice /
 * amount / address is given. Plus the home-delivery minimum check.
 *
 * Run: pnpm --filter @ona/api test src/tests/shopOrderDraft.test.ts
 */
import { describe, it, expect } from 'vitest'
import type { ShoppingItem, ShopOrderLine } from '@ona/shared'
import { draftOrdersFromItems } from '../services/shopOrders/draft.js'
import { orderBlockers, deliveryCheck, carryDraftEdits } from '../services/shopOrders/store.js'
import { buildLine } from '../services/shopOrders/lines.js'

const item = (over: Partial<ShoppingItem> & { name: string }): ShoppingItem => ({
  id: `id-${over.name}`,
  ingredientId: null,
  quantity: 1,
  unit: 'u',
  aisle: 'otros',
  checked: false,
  inStock: false,
  kind: 'menu',
  pricePerUnit: null,
  ...over,
})
const typed = (name: string) => item({ name, kind: 'manual', id: `m-${name}` })

const shops = [
  { id: 'fru', kind: 'fruteria' as const, position: 0, priceMemory: {} },
  { id: 'car', kind: 'carniceria' as const, position: 1, priceMemory: {} },
  { id: 'pes', kind: 'pescaderia' as const, position: 2, priceMemory: {} },
  { id: 'sup', kind: 'supermercado' as const, position: 3, priceMemory: {} },
]

/** Miguel's real list behind the 2026-10-08 order. */
const MIGUEL: ShoppingItem[] = [
  item({ name: 'tomate', quantity: 3, unit: 'u', aisle: 'produce' }),
  item({ name: 'zanahoria', quantity: 150, unit: 'g', aisle: 'produce' }),
  item({ name: 'cebolla', quantity: 225, unit: 'g', aisle: 'produce' }),
  item({ name: 'ajo', quantity: 25, unit: 'g', aisle: 'produce' }),
  item({ name: 'guisantes', quantity: 300, unit: 'g', aisle: 'produce' }),
  item({ name: 'pepino', quantity: 1, unit: 'u', aisle: 'produce' }),
  item({ name: 'pimiento verde', quantity: 1, unit: 'u', aisle: 'produce' }),
  item({ name: 'jamon', quantity: 50, unit: 'g', aisle: 'proteinas' }),
  typed('Jamón serrano'),
  typed('Jamón york'),
  item({ name: 'pescado entero fresco (dorada, lubina, gallo, etc.)', quantity: 2, unit: 'u', aisle: 'otros' }),
  typed('calabacín'),
  item({ name: 'yema de huevo', quantity: 1, unit: 'u' }),
  typed('Leche avena'),
  typed('Harina'),
  typed('Galletas daniela'),
  typed('Yogur'),
  typed('Fruta (fresas, plátanos, naranjas, mandarinas, mango, melón)'),
  typed('Queso'),
  typed('Queso rallado'),
  typed('Queso sandwich'),
  typed('leche'),
  typed('pan'),
  item({ name: 'feta', quantity: 200, unit: 'g', aisle: 'lacteos' }),
  item({ name: 'leche entera', quantity: 50, unit: 'ml', aisle: 'lacteos' }),
  item({ name: 'mantequilla', quantity: 25, unit: 'g', aisle: 'lacteos' }),
  item({ name: 'aceitunas negras', quantity: 22, unit: 'u', aisle: 'despensa' }),
  item({ name: 'alcaparras', quantity: 50, unit: 'g', aisle: 'despensa' }),
  item({ name: 'lentejas', quantity: 400, unit: 'g', aisle: 'despensa' }),
  item({ name: 'cebolla morada', quantity: 2, unit: 'u' }),
  item({ name: 'harina de fuerza', quantity: 150, unit: 'g' }),
  item({ name: 'hierbas aromáticas (romero, tomillo)', quantity: 3, unit: 'u' }),
  item({ name: 'limón', quantity: 5, unit: 'u' }),
  item({ name: 'aceite de oliva virgen', quantity: 60, unit: 'ml', aisle: 'despensa' }),
]

const texts = (r: ReturnType<typeof draftOrdersFromItems>, shop: string) =>
  r.byShop.find((g) => g.shop.id === shop)!.lines.map((l) => (l.included === false ? `(${l.text})` : l.text))

describe("Miguel's list → orders", () => {
  const r = draftOrdersFromItems(MIGUEL, shops)

  it('frutería: shop units, and the produce that went to the súper comes back', () => {
    expect(texts(r, 'fru')).toEqual([
      '3 tomates de ensalada',
      '2 zanahorias',
      '2 cebollas',
      '1 cabeza de ajos',
      '1 pepino',
      '1 pimiento verde italiano',
      '1 calabacín',
      '1 bandeja de fresas',
      '6 plátanos de Canarias',
      '1 kg de naranjas de zumo',
      '1 kg de mandarinas',
      '1 mango',
      '1 melón',
      '2 cebollas moradas',
      '1 manojo de romero',
      '1 manojo de tomillo',
      '5 limones',
    ])
  })

  it('carnicería: jamón merged into one line that waits for serrano/ibérico — no, the typed "serrano" decides it', () => {
    const lines = r.byShop.find((g) => g.shop.id === 'car')!.lines
    expect(lines.map((l) => l.text)).toEqual(['100 g de jamón serrano, loncheado fino', 'jamón cocido extra, en lonchas — ¿cuánto?'])
    expect(lines[0].sourceItemIds).toEqual(['id-jamon', 'm-Jamón serrano'])
    expect(lines[1].needsQuantity?.suggestion).toBe('150 g')
  })

  it('pescadería: one species with an alternative', () => {
    expect(texts(r, 'pes')).toEqual(['2 doradas de ración, limpias para el horno (o lubinas, la que esté mejor hoy)'])
  })

  it('súper: packs, "probablemente lo tienes" unticked, typed leche merged and kept', () => {
    expect(texts(r, 'sup')).toEqual([
      '1 bolsa de guisantes congelados (400 g)',
      '(media docena de huevos)',
      '1 brik de bebida de avena (1 l)',
      '1 paquete de harina de trigo (1 kg)',
      'Galletas daniela',
      '1 pack de 4 yogures naturales',
      '1 paquete de queso — ¿curado, tierno, en lonchas o rallado?',
      '1 bolsa de queso rallado (200 g)',
      '1 paquete de queso en lonchas (200 g)',
      '1 brik de leche entera (1 l)',
      '1 pan — ¿de molde, de hogaza o en barra?',
      '2 paquetes de queso feta (150 g)',
      '(1 tarrina de mantequilla (250 g))',
      '1 lata de aceitunas negras sin hueso (150 g)',
      '1 frasco de alcaparras (80 g)',
      '1 paquete de lentejas (1 kg)',
      '1 paquete de harina de fuerza (1 kg)',
    ])
  })

  it('pantry staples from recipes stay home and are listed to check', () => {
    expect(r.pantry).toEqual(['aceite de oliva virgen'])
  })

  it('blocks the order until the choices and amounts are given', () => {
    const car = r.byShop.find((g) => g.shop.id === 'car')!.lines
    expect(orderBlockers(car, 'recoger', null)).toEqual(['Jamón york: ¿cuánto? (por ejemplo 150 g)'])
    const sup = r.byShop.find((g) => g.shop.id === 'sup')!.lines
    expect(orderBlockers(sup, 'recoger', null)).toEqual(['Queso: ¿Qué queso?', 'Pan: ¿Qué pan?'])
    expect(orderBlockers([], 'domicilio', null)).toEqual(['Falta la dirección de entrega'])
  })

  it('remembered household choices apply on the next draft', () => {
    const again = draftOrdersFromItems([item({ name: 'jamon', quantity: 50, unit: 'g' })], shops, { prefs: { jamon: 'ibérico' } })
    expect(again.byShop[0].lines[0].text).toBe('100 g de jamón ibérico, loncheado fino')
  })
})

describe('deliveryCheck', () => {
  const l = (eur: number | null): ShopOrderLine => ({
    key: 'l', sourceItemId: null, ingredientId: null, name: 'x', quantity: 1, unit: 'u', note: null,
    estimateEur: eur, estimateSource: eur == null ? null : 'referencia', volatile: false, quote: null, verdict: null, reasons: [], decision: null,
  })
  const shop = { name: 'F', kind: 'fruteria' as const, channel: 'whatsapp' as const, whatsapp: '34', email: null, webUrl: null, phone: null, deliveryMinEur: 20, deliveryFeeEur: 10 }

  it('only for home delivery', () => {
    expect(deliveryCheck([l(5)], 'recoger', shop)).toBeNull()
  })
  it('says how much is missing when most of the basket is priced', () => {
    expect(deliveryCheck([l(8), l(6), l(4)], 'domicilio', shop)).toEqual({ minEur: 20, feeEur: 10, estimateEur: 18, confident: true, shortByEur: 2 })
  })
  it('is honest when it can\'t tell', () => {
    expect(deliveryCheck([l(8), l(null), l(null)], 'domicilio', shop)?.confident).toBe(false)
  })
})

describe('re-preparing keeps the user\'s edits', () => {
  it('added products, amounts, picks and delivery survive a new draft', () => {
    const fresh = draftOrdersFromItems([typed('Jamón york'), item({ name: 'tomate', quantity: 3, unit: 'u', aisle: 'produce' })], shops)
    const car = fresh.byShop.find((g) => g.shop.id === 'car')!
    const fru = fresh.byShop.find((g) => g.shop.id === 'fru')!
    // The user answered "150 g" for the york and added apples to the frutería, delivered home.
    const york = car.lines[0]
    const editedYork = buildLine({ key: york.key, sourceItemIds: york.sourceItemIds!, ingredientId: null, name: york.name, quantity: 150, unit: 'g', quantitySource: 'user', notes: [], note: null, choice: null }, 'carniceria', {}, {})
    const apples = buildLine({ key: 'l9', sourceItemIds: [], ingredientId: null, name: 'manzanas', quantity: 1000, unit: 'g', quantitySource: 'user', notes: [], note: null, choice: null, included: true }, 'fruteria', {}, {})
    const out = carryDraftEdits(
      fresh.byShop.map((g) => ({ shopId: g.shop.id, kind: g.kind, lines: g.lines, priceMemory: {} })),
      [
        { shopId: 'car', lines: [editedYork], fulfilment: 'recoger', address: null },
        { shopId: 'fru', lines: [...fru.lines, apples], fulfilment: 'domicilio', address: 'C/ Real 1' },
      ],
      shops.map((x) => ({ id: x.id, kind: x.kind, priceMemory: {} })),
      {},
    )
    const carOut = out.find((o) => o.shopId === 'car')!
    expect(carOut.lines.map((l) => l.text)).toEqual(['150 g de jamón cocido extra, en lonchas'])
    const fruOut = out.find((o) => o.shopId === 'fru')!
    expect(fruOut.lines.map((l) => l.text)).toEqual(['3 tomates de ensalada', '1 kg de manzanas'])
    expect(fruOut).toMatchObject({ fulfilment: 'domicilio', address: 'C/ Real 1' })
  })
})
