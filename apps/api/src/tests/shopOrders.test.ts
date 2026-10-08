/**
 * "Compra en mis tiendas" — pure logic (specs/shop-orders.md):
 * routing a shopping-list line to a shop kind, fish yields, estimates,
 * the order / confirmation messages and the quote assessment (±band, cap,
 * wild fish always to approval).
 *
 * Run: pnpm --filter @ona/api test src/tests/shopOrders.test.ts
 */

import { describe, it, expect } from 'vitest'
import type { ShopOrderLine } from '@ona/shared'
import { classifyShopKind, pickShopForKind } from '../services/shopOrders/classify.js'
import { fishYield, isVolatileFish, wholeWeightGrams } from '../services/shopOrders/fish.js'
import { formatQty, lineRequestText, prettyName } from '../services/shopOrders/format.js'
import { estimateLine, defaultCap } from '../services/shopOrders/estimate.js'
import { capForLines } from '../services/shopOrders/draft.js'
import {
  buildOrderMessage,
  buildConfirmationMessage,
  waLink,
  mailtoLink,
  shopSearchUrl,
  isTooLongToPrefill,
} from '../services/shopOrders/message.js'
import { assessQuote } from '../services/shopOrders/validation.js'
import { draftOrdersFromItems } from '../services/shopOrders/draft.js'

function line(over: Partial<ShopOrderLine> = {}): ShopOrderLine {
  return {
    key: 'l1',
    sourceItemId: 'menu:x:g',
    ingredientId: 'x',
    name: 'tomate',
    quantity: 1000,
    unit: 'g',
    note: null,
    estimateEur: null,
    estimateSource: null,
    volatile: false,
    quote: null,
    verdict: null,
    reasons: [],
    decision: null,
    ...over,
  }
}

describe('classifyShopKind', () => {
  it.each([
    ['merluza', 'proteinas', 'pescaderia'],
    ['salmon', 'proteinas', 'pescaderia'],
    ['gambas', 'proteinas', 'pescaderia'],
    ['mejillones', 'proteinas', 'pescaderia'],
    ['bacalao desalado', null, 'pescaderia'],
    ['atun fresco', 'proteinas', 'pescaderia'],
    ['ternera', 'proteinas', 'carniceria'],
    ['Filete de ternera', null, 'carniceria'],
    ['pollo', 'proteinas', 'carniceria'],
    ['costillas de cerdo', 'proteinas', 'carniceria'],
    ['chorizo asturiano', null, 'carniceria'],
    ['lacón', null, 'carniceria'],
    ['hueso de caña con tuétano', null, 'carniceria'],
    ['tomate', 'produce', 'fruteria'],
    ['patata', 'produce', 'fruteria'],
    ['albahaca', 'produce', 'fruteria'],
    ['setas', 'produce', 'fruteria'],
  ] as const)('%s (%s) → %s', (name, aisle, kind) => {
    expect(classifyShopKind(name, aisle)).toBe(kind)
  })

  it.each([
    ['atun', 'proteinas'], // ambiguous: in recipes it is usually canned
    ['caldo de pescado', null],
    ['caldo de pollo', 'despensa'],
    ['tomate triturado', 'despensa'],
    ['huevo', 'proteinas'],
    ['tofu', 'proteinas'],
    ['leche entera', 'lacteos'],
    ['pan blanco', 'panaderia'],
    ['detergente', 'otros'],
    ['guisantes', 'congelados'],
  ] as const)('%s (%s) → supermercado', (name, aisle) => {
    expect(classifyShopKind(name, aisle)).toBe('supermercado')
  })
})

describe('pickShopForKind', () => {
  const shops = [
    { id: 's-super', kind: 'supermercado' as const, position: 0 },
    { id: 's-fruta', kind: 'fruteria' as const, position: 1 },
  ]
  it('prefers a shop of the same kind', () => {
    expect(pickShopForKind('fruteria', shops)?.id).toBe('s-fruta')
  })
  it('falls back to the supermarket when there is no shop of that kind', () => {
    expect(pickShopForKind('pescaderia', shops)?.id).toBe('s-super')
  })
  it('returns null when nothing fits', () => {
    expect(pickShopForKind('carniceria', [{ id: 'f', kind: 'fruteria' as const, position: 0 }])).toBeNull()
  })
})

describe('fish', () => {
  it('knows the FAO edible yield of common species', () => {
    expect(fishYield('merluza')).toBe(0.53)
    expect(fishYield('dorada')).toBe(0.54)
    expect(fishYield('sardinas')).toBe(0.62)
    expect(fishYield('salmon')).toBeNull() // bought as loins, no conversion
  })
  it('converts a clean weight to the whole weight the shop charges, rounded to 50 g', () => {
    expect(wholeWeightGrams('merluza', 600)).toBe(1150)
    expect(wholeWeightGrams('salmon', 600)).toBeNull()
  })
  it('flags wild, auction-priced species as volatile', () => {
    expect(isVolatileFish('merluza')).toBe(true)
    expect(isVolatileFish('sardinas')).toBe(true)
    expect(isVolatileFish('gambas')).toBe(true)
    expect(isVolatileFish('dorada')).toBe(false) // farmed, stable
    expect(isVolatileFish('salmon')).toBe(false)
    expect(isVolatileFish('mejillones')).toBe(false)
    expect(isVolatileFish('tomate')).toBe(false)
  })
})

describe('formatQty / lineRequestText', () => {
  it.each([
    [500, 'g', '500 g'],
    [1200, 'g', '1,2 kg'],
    [1000, 'g', '1 kg'],
    [1, 'u', '1 unidad'],
    [3, 'u', '3 unidades'],
    [750, 'ml', '750 ml'],
    [1500, 'ml', '1,5 l'],
    [2, 'cda', '2 cucharadas'],
  ] as const)('%s %s → %s', (q, u, out) => {
    expect(formatQty(q, u)).toBe(out)
  })

  it('restores the accents the catalogue drops, so the shop reads proper Spanish', () => {
    expect(prettyName('champinones')).toBe('champiñones')
    expect(prettyName('judias verdes')).toBe('judías verdes')
    expect(prettyName('jamon')).toBe('jamón')
    expect(prettyName('hueso de cana con tuetano')).toBe('hueso de caña con tuétano')
    expect(prettyName('Filete de ternera')).toBe('Filete de ternera')
    expect(lineRequestText(line({ name: 'salmon', quantity: 200 }), 'pescaderia')).toBe('- Salmón: 200 g')
  })

  it('writes plain lines with the note', () => {
    expect(lineRequestText(line({ name: 'ternera', quantity: 500, note: 'picada' }), 'carniceria')).toBe('- Ternera: 500 g (picada)')
  })
  it('asks fish by clean weight and gives the whole weight the shop weighs', () => {
    expect(lineRequestText(line({ name: 'merluza', quantity: 600, note: 'en lomos, sin piel' }), 'pescaderia')).toBe(
      '- Merluza: 600 g en limpio (≈1,15 kg en entero), en lomos, sin piel',
    )
    // Species without a known yield (bought as loins/fillets) stay as asked.
    expect(lineRequestText(line({ name: 'salmon', quantity: 400, note: null }), 'pescaderia')).toBe('- Salmón: 400 g')
  })
})

describe('estimateLine / defaultCap', () => {
  it('uses the price the user typed in the list first', () => {
    expect(estimateLine({ ingredientId: 'x', name: 'tomate', quantity: 1000, unit: 'g', pricePerUnit: 0.0025 }, 'fruteria', {})).toEqual({
      eur: 2.5,
      source: 'manual',
    })
  })
  it('then the €/kg this shop quoted last time (whole weight for fish)', () => {
    expect(estimateLine({ ingredientId: 'm', name: 'merluza', quantity: 600, unit: 'g', pricePerUnit: null }, 'pescaderia', { m: { pricePerKg: 20, at: '2026-10-01' } })).toEqual({
      eur: 23,
      source: 'historial',
    })
  })
  it('then a national reference €/kg for the shop kind', () => {
    const r = estimateLine({ ingredientId: 'x', name: 'tomate', quantity: 1000, unit: 'g', pricePerUnit: null }, 'fruteria', {})
    expect(r.source).toBe('referencia')
    expect(r.eur).toBeGreaterThan(1)
    expect(r.eur).toBeLessThan(4)
  })
  it('returns null when it cannot estimate (packaged goods by unit)', () => {
    expect(estimateLine({ ingredientId: 'x', name: 'detergente', quantity: 1, unit: 'u', pricePerUnit: null }, 'supermercado', {})).toEqual({
      eur: null,
      source: null,
    })
  })
  it('cap = estimate +10 %, +20 % with wild fish, rounded up to the euro', () => {
    expect(defaultCap(40, false)).toBe(44)
    expect(defaultCap(40, true)).toBe(48)
    expect(defaultCap(41.2, false)).toBe(46)
    expect(defaultCap(null, false)).toBeNull()
    expect(defaultCap(0, false)).toBeNull()
  })
})

describe('capForLines', () => {
  it('only proposes a cap when most of the estimate comes from precise prices', () => {
    expect(capForLines([line({ estimateEur: 10, estimateSource: 'historial' }), line({ key: 'l2', estimateEur: 2, estimateSource: 'referencia' })])).toBe(14)
    expect(capForLines([line({ estimateEur: 10, estimateSource: 'historial', volatile: true })])).toBe(12)
  })
  it('no cap from national averages alone — the user sets it', () => {
    expect(capForLines([line({ estimateEur: 6, estimateSource: 'referencia' })])).toBeNull()
    expect(capForLines([line({ estimateEur: 2, estimateSource: 'manual' }), line({ key: 'l2', estimateEur: 6, estimateSource: 'referencia' })])).toBeNull()
    expect(capForLines([])).toBeNull()
  })
})

describe('order and confirmation messages', () => {
  const lines = [line({ name: 'tomate', quantity: 1000 }), line({ key: 'l2', name: 'calabacin', quantity: 2, unit: 'u' })]

  it('is written by the customer, lists every line and asks the total and from when to pick it up', () => {
    const msg = buildOrderMessage({ kind: 'fruteria', channel: 'whatsapp', customerName: 'Miguel', fulfilment: 'recoger', address: null, lines })
    expect(msg).toMatch(/^Hola, soy Miguel\./)
    expect(msg).toContain('para recoger en la tienda')
    expect(msg).toContain('- Tomate: 1 kg')
    expect(msg).toContain('- Calabacín: 2 unidades')
    expect(msg).toContain('Antes de prepararlo, ¿me decís el total aproximado y a partir de qué hora puedo pasar a recogerlo? Gracias.')
    expect(msg).not.toContain('precio por kilo') // frutería: the total is enough
  })
  it('home delivery always carries the address and asks roughly when it arrives', () => {
    const msg = buildOrderMessage({ kind: 'fruteria', channel: 'whatsapp', customerName: 'Miguel', fulfilment: 'domicilio', address: 'C/ Real 1, Boadilla', lines })
    expect(msg).toContain('Os paso un pedido para que me lo traigáis a C/ Real 1, Boadilla:')
    expect(msg).toContain('¿me decís el total aproximado y más o menos a qué hora llegaría?')
  })
  it('meat asks the €/kg and an alternative — but not for a charcutería-only order', () => {
    const meat = buildOrderMessage({ kind: 'carniceria', channel: 'whatsapp', customerName: null, fulfilment: 'recoger', address: null, lines: [line({ name: 'ternera', ruleKey: 'carne picada', text: 'medio kilo de carne picada mixta' })] })
    expect(meat).toContain('Si no hay algo, decidme qué me recomendáis en su lugar.')
    expect(meat).toContain('el precio por kilo, el total aproximado y a partir de qué hora puedo pasar a recogerlo')
    const charcu = buildOrderMessage({ kind: 'carniceria', channel: 'whatsapp', customerName: null, fulfilment: 'recoger', address: null, lines: [line({ name: 'jamon', ruleKey: 'jamon', text: '100 g de jamón serrano, loncheado fino' })] })
    expect(charcu).not.toContain('Si no hay algo')
    expect(charcu).toContain('- 100 g de jamón serrano, loncheado fino')
  })
  it('"probablemente lo tienes" lines stay out of the message until ticked', () => {
    const msg = buildOrderMessage({ kind: 'supermercado', channel: 'web', customerName: null, fulfilment: 'recoger', address: null, lines: [line({ text: '1 tarrina de mantequilla (250 g)', included: false }), line({ key: 'l2', text: '1 paquete de lentejas (1 kg)' })] })
    expect(msg).toBe('Lista de la compra:\n\n- 1 paquete de lentejas (1 kg)')
  })
  it('asks the fishmonger what to bring instead when something is missing', () => {
    const msg = buildOrderMessage({ kind: 'pescaderia', channel: 'whatsapp', customerName: null, fulfilment: 'domicilio', address: 'C/ Real 1, Pozuelo', lines: [line({ name: 'merluza', quantity: 600, volatile: true })] })
    expect(msg).toMatch(/^Hola\./)
    expect(msg).toContain('a C/ Real 1, Pozuelo')
    expect(msg).toMatch(/si no hay algo/i)
  })
  it('for a web shop it is a plain checklist (no greeting, no questions)', () => {
    const msg = buildOrderMessage({ kind: 'supermercado', channel: 'web', customerName: 'Miguel', fulfilment: 'domicilio', address: 'Boadilla', lines })
    expect(msg).toBe('Lista de la compra:\n\n- Tomate: 1 kg\n- Calabacín: 2 unidades')
  })
  it('wa.me / mailto links carry the encoded text', () => {
    expect(waLink('34638015827', 'Hola, ñ')).toBe('https://wa.me/34638015827?text=Hola%2C%20%C3%B1')
    expect(mailtoLink('a@b.es', 'Pedido', 'Hola')).toBe('mailto:a@b.es?subject=Pedido&body=Hola')
  })
  it('flags texts too long to prefill safely', () => {
    expect(isTooLongToPrefill('x'.repeat(500))).toBe(false)
    expect(isTooLongToPrefill('x'.repeat(1500))).toBe(true)
  })
  it('builds a product search link only for shops whose search URL is known', () => {
    expect(shopSearchUrl('https://www.elcorteingles.es/supermercado/', 'tomate triturado')).toBe(
      'https://www.elcorteingles.es/supermercado/buscar?question=tomate%20triturado&catalog=supermercado',
    )
    expect(shopSearchUrl('https://www.ejemplo.es', 'tomate')).toBeNull()
    expect(shopSearchUrl(null, 'tomate')).toBeNull()
  })
  it('confirmation: go ahead, drop the removed lines, accept substitutes, repeat the cap', () => {
    const msg = buildConfirmationMessage({
      lines: [
        line({ name: 'tomate', decision: 'keep', quote: { status: 'ok', quantityText: null, pricePerKg: 2, lineTotal: 2, substitute: null, comment: null } }),
        line({ key: 'l2', name: 'merluza', decision: 'keep', quote: { status: 'sustituto', quantityText: null, pricePerKg: null, lineTotal: null, substitute: 'pescadilla', comment: null } }),
        line({ key: 'l3', name: 'sardinas', decision: 'remove' }),
        line({ key: 'l5', name: 'brocoli', decision: 'remove' }),
        line({ key: 'l4', name: 'mejillones', decision: 'keep', quote: { status: 'no_hay', quantityText: null, pricePerKg: null, lineTotal: null, substitute: null, comment: null } }),
      ],
      capEur: 45,
    })
    expect(msg).toContain('adelante')
    expect(msg).toContain('Quita: sardinas, brócoli')
    expect(msg).toContain('Sí a pescadilla en lugar de merluza')
    expect(msg).not.toContain('mejillones') // the shop already said there's none
    expect(msg).toContain('45 €')
  })
  it('confirmation with everything kept is a plain go-ahead', () => {
    const msg = buildConfirmationMessage({ lines: [line({ decision: 'keep' })], capEur: null })
    expect(msg).toMatch(/^Perfecto, adelante con todo/)
    expect(msg).not.toContain('Quita')
  })
})

describe('assessQuote', () => {
  const q = (over: Partial<NonNullable<ShopOrderLine['quote']>> = {}) => ({
    status: 'ok' as const,
    quantityText: null,
    pricePerKg: null,
    lineTotal: null,
    substitute: null,
    comment: null,
    ...over,
  })

  it('ok when the line is within ±10 % of a precise estimate', () => {
    const r = assessQuote([line({ estimateEur: 10, estimateSource: 'historial', quote: q({ lineTotal: 10.9 }) })], { totalEur: null, capEur: null })
    expect(r.lines[0].verdict).toBe('ok')
    expect(r.summary.needsDecision).toBe(false)
  })
  it('revisar when the line is more than 10 % above a precise estimate', () => {
    const r = assessQuote([line({ estimateEur: 10, estimateSource: 'manual', quote: q({ lineTotal: 11.5 }) })], { totalEur: null, capEur: null })
    expect(r.lines[0].verdict).toBe('revisar')
    expect(r.lines[0].reasons.join(' ')).toMatch(/15 %/)
  })
  it('does not use rough reference prices to flag a line', () => {
    const r = assessQuote([line({ estimateEur: 10, estimateSource: 'referencia', quote: q({ lineTotal: 16 }) })], { totalEur: null, capEur: null })
    expect(r.lines[0].verdict).toBe('ok')
  })
  it('wild fish always goes to the user', () => {
    const r = assessQuote([line({ name: 'merluza', volatile: true, quote: q({ lineTotal: 20 }) })], { totalEur: null, capEur: null })
    expect(r.lines[0].verdict).toBe('revisar')
  })
  it('substitutes, partial lines and lines the shop did not mention go to the user', () => {
    const r = assessQuote(
      [
        line({ key: 'a', quote: q({ status: 'sustituto', substitute: 'pescadilla' }) }),
        line({ key: 'b', quote: q({ status: 'parcial' }) }),
        line({ key: 'c', quote: null }),
      ],
      { totalEur: null, capEur: null },
    )
    expect(r.lines.map((l) => l.verdict)).toEqual(['revisar', 'revisar', 'revisar'])
  })
  it('"no hay" lines are dropped by default, not substituted', () => {
    const r = assessQuote([line({ quote: q({ status: 'no_hay' }) })], { totalEur: null, capEur: null })
    expect(r.lines[0].verdict).toBe('no_hay')
    expect(r.lines[0].decision).toBe('remove')
  })
  it('default decision: keep ok lines, wait for the user on revisar lines', () => {
    const r = assessQuote([line({ key: 'a', quote: q({ lineTotal: 2 }) }), line({ key: 'b', volatile: true, quote: q({ lineTotal: 20 }) })], { totalEur: null, capEur: null })
    expect(r.lines.map((l) => l.decision)).toEqual(['keep', null])
  })
  it('over the cap (shop total, or the sum of line totals) needs a decision', () => {
    const byTotal = assessQuote([line({ quote: q({ lineTotal: 2 }) })], { totalEur: 50, capEur: 45 })
    expect(byTotal.summary.overCap).toBe(true)
    expect(byTotal.summary.needsDecision).toBe(true)
    const bySum = assessQuote([line({ key: 'a', quote: q({ lineTotal: 30 }) }), line({ key: 'b', quote: q({ lineTotal: 20 }) })], { totalEur: null, capEur: 45 })
    expect(bySum.summary.totalEur).toBe(50)
    expect(bySum.summary.overCap).toBe(true)
  })
})

describe('draftOrdersFromItems', () => {
  const item = (over: Partial<import('@ona/shared').ShoppingItem>): import('@ona/shared').ShoppingItem => ({
    id: 'menu:x:g',
    ingredientId: 'x',
    name: 'tomate',
    quantity: 1000,
    unit: 'g',
    aisle: 'produce',
    checked: false,
    inStock: false,
    kind: 'menu',
    pricePerUnit: null,
    ...over,
  })
  const shops = [
    { id: 'fru', kind: 'fruteria' as const, position: 0, priceMemory: {} },
    { id: 'pes', kind: 'pescaderia' as const, position: 1, priceMemory: {} },
    { id: 'sup', kind: 'supermercado' as const, position: 2, priceMemory: {} },
  ]

  it('routes each pending item to its shop, súper as fallback, with keys and estimates', () => {
    const r = draftOrdersFromItems(
      [
        item({ id: 'a', name: 'tomate' }),
        item({ id: 'b', name: 'merluza', aisle: 'proteinas', quantity: 600 }),
        item({ id: 'c', name: 'pollo', aisle: 'proteinas', quantity: 800 }), // no carnicería → súper
        item({ id: 'd', name: 'leche entera', aisle: 'lacteos', unit: 'ml', quantity: 2000 }),
      ],
      shops,
    )
    expect(r.byShop.map((g) => [g.shop.id, g.lines.map((l) => l.name)])).toEqual([
      ['fru', ['tomate']],
      ['pes', ['merluza']],
      ['sup', ['pollo', 'leche entera']],
    ])
    expect(r.byShop[2].lines.map((l) => l.key)).toEqual(['l1', 'l2'])
    expect(r.byShop[1].lines[0].volatile).toBe(true)
    expect(r.byShop[0].lines[0].estimateSource).toBe('referencia')
  })

  it('leaves out bought / at-home items, pantry basics and items already in an open order', () => {
    const r = draftOrdersFromItems(
      [
        item({ id: 'a', checked: true }),
        item({ id: 'b', inStock: true }),
        item({ id: 'c', name: 'aceite de oliva virgen', aisle: 'despensa', unit: 'ml', quantity: 60 }),
        item({ id: 'd', name: 'oregano', aisle: 'despensa', unit: 'cdita', quantity: 1 }),
        item({ id: 'e', name: 'patata' }),
        item({ id: 'f', name: 'aceite de oliva', aisle: 'otros', kind: 'manual', quantity: 1, unit: 'u' }), // typed by the user: buy it
      ],
      shops,
      { alreadyOrdered: new Set(['e']) },
    )
    expect(r.skipped.map((s) => s.name)).toEqual(['aceite de oliva virgen', 'oregano', 'patata'])
    expect(r.byShop.flatMap((g) => g.lines.map((l) => l.name))).toEqual(['aceite de oliva'])
  })

  it('reports lines with nowhere to go', () => {
    const r = draftOrdersFromItems([item({ name: 'ternera', aisle: 'proteinas' })], [shops[0]])
    expect(r.unassigned).toEqual([{ name: 'ternera', quantity: 1000, unit: 'g', kind: 'carniceria' }])
  })
})
