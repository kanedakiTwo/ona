/**
 * «Enviar la cesta a la extensión del navegador» (specs/shop-orders.md):
 * el esquema del resultado, la lista de emails y qué hace la API con cada resultado.
 *
 * Run: pnpm --filter @ona/api test src/tests/basketExtension.test.ts
 */
import { describe, it, expect } from 'vitest'
import { basketSendResultSchema, type BasketSendResult, type ShopOrderLine, type StoredBasketResult } from '@ona/shared'
import { aggregateBasketGaps, decideBasketResult, isBasketExtensionAllowed } from '../services/basketExtension.js'
import { saveBasketResult } from '../services/shopOrders/store.js'
import { buildLine } from '../services/shopOrders/lines.js'
import { shopOrders, users } from '../db/schema.js'

export const okResult = (over: Partial<BasketSendResult> = {}): BasketSendResult => ({
  envioId: 'e1',
  ok: true,
  lineas: [
    { key: 'l1', estado: 'tabla', productoId: '100', producto: 'Arroz redondo', unidades: 1 },
    { key: 'l2', estado: 'busqueda', productoId: '200', producto: 'Detergente', unidades: 1 },
  ],
  anadidas: 2,
  totalEur: 12.5,
  bajoMinimo: true,
  version: '0.1.0',
  contrato: 'c1',
  ...over,
})

describe('basketSendResultSchema', () => {
  it('acepta un resultado bueno y uno fallido antes de escribir', () => {
    expect(basketSendResultSchema.safeParse(okResult()).success).toBe(true)
    expect(basketSendResultSchema.safeParse(okResult({ envioId: '', ok: false, error: 'sin_sesion', lineas: [], anadidas: 0, totalEur: null })).success).toBe(true)
  })
  it('rechaza estados y errores desconocidos y listas enormes', () => {
    expect(basketSendResultSchema.safeParse({ ...okResult(), error: 'otro' }).success).toBe(false)
    expect(basketSendResultSchema.safeParse({ ...okResult(), lineas: [{ key: 'l1', estado: 'raro' }] }).success).toBe(false)
    const muchas = Array.from({ length: 201 }, (_, i) => ({ key: `l${i}`, estado: 'tabla' as const }))
    expect(basketSendResultSchema.safeParse({ ...okResult(), lineas: muchas }).success).toBe(false)
  })
  it('cotas: 200 líneas sí; repetido false, motivo desconocido y unidades no enteras no', () => {
    const doscientas = Array.from({ length: 200 }, (_, i) => ({ key: `l${i}`, estado: 'tabla' as const }))
    expect(basketSendResultSchema.safeParse({ ...okResult(), lineas: doscientas }).success).toBe(true)
    expect(basketSendResultSchema.safeParse({ ...okResult(), repetido: false }).success).toBe(false)
    expect(basketSendResultSchema.safeParse({ ...okResult(), lineas: [{ key: 'l1', estado: 'fallida', motivo: 'otro' }] }).success).toBe(false)
    expect(basketSendResultSchema.safeParse({ ...okResult(), lineas: [{ key: 'l1', estado: 'tabla', unidades: 1.5 }] }).success).toBe(false)
  })
  it('si puede haber algo en el carro, el envioId no puede ir vacío', () => {
    expect(basketSendResultSchema.safeParse(okResult({ envioId: '' })).success).toBe(false)
    const aMedias = okResult({ envioId: '', ok: false, error: 'verificacion', anadidas: 0, lineas: [{ key: 'l1', estado: 'no_verificada' }] })
    expect(basketSendResultSchema.safeParse(aMedias).success).toBe(false)
    expect(basketSendResultSchema.safeParse({ ...aMedias, envioId: 'e1' }).success).toBe(true)
  })
})

const stored = (over: Partial<StoredBasketResult> = {}): StoredBasketResult => ({ ...okResult(), recibidoAt: '2026-10-19T10:00:00.000Z', deshechoAt: null, deshechos: [], ...over })
const NOW = new Date('2026-10-19T11:00:00.000Z')

describe('isBasketExtensionAllowed', () => {
  it('vacía = nadie; email exacto o @dominio; sin distinguir mayúsculas', () => {
    expect(isBasketExtensionAllowed('a@b.es', [])).toBe(false)
    expect(isBasketExtensionAllowed('Ana@B.es', ['ana@b.es'])).toBe(true)
    expect(isBasketExtensionAllowed('x_1@test.local', ['@test.local'])).toBe(true)
    expect(isBasketExtensionAllowed('x@otro.es', ['@test.local'])).toBe(false)
    expect(isBasketExtensionAllowed(null, ['@test.local'])).toBe(false)
  })
  it('el dominio se compara con su @ y el email se recorta', () => {
    expect(isBasketExtensionAllowed('x@eviltest.local', ['@test.local'])).toBe(false)
    expect(isBasketExtensionAllowed(' Ana@B.es ', ['ana@b.es'])).toBe(true)
  })
})

describe('decideBasketResult', () => {
  it('primer envío bueno → guarda y pasa a sent', () => {
    const d = decideBasketResult(null, 'draft', okResult(), NOW)
    expect(d).toMatchObject({ action: 'save', status: 'sent' })
  })
  it('fallo antes de escribir en un borrador → guarda y sigue en draft', () => {
    const d = decideBasketResult(null, 'draft', okResult({ envioId: '', ok: false, error: 'sin_sesion', lineas: [], anadidas: 0 }), NOW)
    expect(d).toMatchObject({ action: 'save', status: 'draft' })
  })
  it('un resultado vacío nunca pisa un envío bueno', () => {
    expect(decideBasketResult(stored(), 'sent', okResult({ envioId: '', ok: false, error: 'red', lineas: [], anadidas: 0 }), NOW)).toEqual({ action: 'keep' })
  })
  it('repetido del envío vivo, o el mismo envioId reintentado → nada; un envío deshecho → deshecho', () => {
    expect(decideBasketResult(stored(), 'sent', okResult({ repetido: true }), NOW)).toEqual({ action: 'keep' })
    expect(decideBasketResult(stored(), 'sent', okResult(), NOW)).toEqual({ action: 'keep' })
    const undone = stored({ deshechoAt: '2026-10-19T10:30:00.000Z', deshechos: ['e1'] })
    expect(decideBasketResult(undone, 'draft', okResult({ repetido: true }), NOW)).toEqual({ action: 'deshecho' })
  })
  it('un envío a medias (todo sin verificar) también pasa a sent, para poder deshacerlo', () => {
    const aMedias = okResult({ envioId: 'e9', ok: false, error: 'verificacion', repetido: true, anadidas: 0,
      lineas: [{ key: 'l1', estado: 'no_verificada', productoId: '1', unidades: 1 }] })
    expect(decideBasketResult(null, 'draft', aMedias, NOW)).toMatchObject({ action: 'save', status: 'sent' })
  })
  it('después de deshacer, un envío nuevo guarda y conserva el historial', () => {
    const undone = stored({ deshechoAt: '2026-10-19T10:30:00.000Z', deshechos: ['e1'] })
    const d = decideBasketResult(undone, 'draft', okResult({ envioId: 'e2' }), NOW)
    expect(d).toMatchObject({ action: 'save', status: 'sent' })
    if (d.action === 'save') expect(d.stored).toMatchObject({ envioId: 'e2', deshechoAt: null, deshechos: ['e1'], recibidoAt: NOW.toISOString() })
  })
  it('el mismo envioId otra vez no cambia nada aunque el guardado no esté vivo (todo fallida)', () => {
    const todoFallida = okResult({ ok: false, anadidas: 0, lineas: [{ key: 'l1', estado: 'fallida', motivo: 'no_encontrado' }] })
    expect(decideBasketResult(stored(todoFallida), 'draft', todoFallida, NOW)).toEqual({ action: 'keep' })
  })
  it('un guardado que no está vivo se sustituye; dos fallos sin envioId no se confunden', () => {
    const todoFallida = okResult({ ok: false, anadidas: 0, lineas: [{ key: 'l1', estado: 'fallida', motivo: 'no_encontrado' }] })
    const fallo = okResult({ envioId: '', ok: false, error: 'red', lineas: [], anadidas: 0 })
    expect(decideBasketResult(stored(todoFallida), 'draft', fallo, NOW)).toMatchObject({ action: 'save', status: 'draft' })
    const otroFallo = okResult({ envioId: '', ok: false, error: 'sin_sesion', lineas: [], anadidas: 0 })
    expect(decideBasketResult(stored(fallo), 'draft', otroFallo, NOW)).toMatchObject({ action: 'save', status: 'draft', stored: { error: 'sin_sesion' } })
  })
  it('un fallo no saca de sent un pedido enviado; tras deshacer, un fallo vacío se guarda en draft', () => {
    const fallo = okResult({ envioId: '', ok: false, error: 'red', lineas: [], anadidas: 0 })
    expect(decideBasketResult(null, 'sent', fallo, NOW)).toMatchObject({ action: 'save', status: 'sent' })
    const undone = stored({ deshechoAt: '2026-10-19T10:30:00.000Z', deshechos: ['e1'] })
    const d = decideBasketResult(undone, 'draft', fallo, NOW)
    expect(d).toMatchObject({ action: 'save', status: 'draft' })
    if (d.action === 'save') expect(d.stored.deshechos).toEqual(['e1'])
  })
  it('un pedido que no está en draft ni en sent no se toca', () => {
    expect(decideBasketResult(null, 'closed', okResult(), NOW)).toEqual({ action: 'keep' })
    expect(decideBasketResult(null, 'cancelled', okResult({ envioId: '', ok: false, error: 'red', lineas: [], anadidas: 0 }), NOW)).toEqual({ action: 'keep' })
  })
  it('guarda la foto de la cesta tal como se mandó (solo clave, nombre y elección)', () => {
    const cesta = [{ key: 'l1', name: 'Arroz', choice: null, quantity: 1000, unit: 'g' as const, grams: 1000, piezas: null, search: 'Arroz' }]
    const d = decideBasketResult(null, 'draft', okResult(), NOW, cesta)
    if (d.action !== 'save') throw new Error(d.action)
    expect(d.stored.cesta).toEqual([{ key: 'l1', name: 'Arroz', choice: null }])
    const sin = decideBasketResult(null, 'draft', okResult(), NOW)
    if (sin.action !== 'save') throw new Error(sin.action)
    expect('cesta' in sin.stored).toBe(false)
  })
})

describe('aggregateBasketGaps', () => {
  it('cuenta lo que llegó por búsqueda o falló, con su nombre en la lista', () => {
    const lines = [
      { key: 'l1', name: 'arroz', quantity: 1000, unit: 'g', ruleKey: 'arroz', grams: 1000 },
      { key: 'l2', name: 'detergente', quantity: 1, unit: 'u' },
    ] as unknown as ShopOrderLine[]
    const result = stored({ lineas: [
      { key: 'l1', estado: 'tabla', productoId: '100', unidades: 1 },
      { key: 'l2', estado: 'busqueda', productoId: '200', producto: 'Detergente', unidades: 1 },
    ] })
    const gaps = aggregateBasketGaps([{ lines, result }, { lines, result }])
    expect(gaps).toEqual([{ name: 'detergente', choice: null, search: 'detergente', estado: 'busqueda', productoId: '200', producto: 'Detergente', motivo: null, veces: 2 }])
  })
  const linea = (key: string, name: string) => ({ key, name, quantity: 1, unit: 'u' }) as unknown as ShopOrderLine
  it('usa la foto de la cesta si la hay, aunque las líneas de ahora digan otra cosa', () => {
    const result = stored({
      lineas: [{ key: 'l2', estado: 'busqueda', productoId: '200' }],
      cesta: [{ key: 'l2', name: 'Jamón', choice: 'serrano' }],
    })
    expect(aggregateBasketGaps([{ lines: [linea('l2', 'lejía')], result }])).toEqual([
      { name: 'Jamón', choice: 'serrano', search: 'Jamón serrano', estado: 'busqueda', productoId: '200', producto: null, motivo: null, veces: 1 },
    ])
  })
  it('salta las claves que ya no están, sin lanzar; los envíos deshechos cuentan; no_verificada no', () => {
    const result = stored({
      deshechoAt: '2026-10-19T10:30:00.000Z',
      deshechos: ['e1'],
      lineas: [
        { key: 'l9', estado: 'fallida', motivo: 'no_encontrado' },
        { key: 'l1', estado: 'no_verificada', productoId: '1' },
        { key: 'l2', estado: 'fallida', motivo: 'no_encontrado' },
      ],
    })
    expect(aggregateBasketGaps([{ lines: [linea('l1', 'arroz'), linea('l2', 'sal')], result }])).toEqual([
      { name: 'sal', choice: null, search: 'sal', estado: 'fallida', productoId: null, producto: null, motivo: 'no_encontrado', veces: 1 },
    ])
  })
  it('agrupa por nombre normalizado, producto, estado y motivo; ordena por veces y luego por nombre', () => {
    const lines = [linea('l1', 'Detergente'), linea('l2', 'detergente'), linea('l3', 'Detergente · varias presentaciones'), linea('l4', 'sal'), linea('l5', 'azúcar')]
    const r = (lineas: StoredBasketResult['lineas']) => ({ lines, result: stored({ lineas }) })
    const gaps = aggregateBasketGaps([
      r([
        { key: 'l1', estado: 'busqueda', productoId: '200' },
        { key: 'l2', estado: 'busqueda', productoId: '200' },
        { key: 'l3', estado: 'busqueda', productoId: '200' },
        { key: 'l4', estado: 'busqueda', productoId: '300' },
        { key: 'l5', estado: 'fallida', motivo: 'no_encontrado' },
      ]),
      r([
        { key: 'l1', estado: 'busqueda', productoId: '201' },
        { key: 'l4', estado: 'fallida', productoId: '300' },
        { key: 'l5', estado: 'fallida', motivo: 'error' },
      ]),
    ])
    expect(gaps.map((g) => [g.name, g.estado, g.productoId, g.motivo, g.veces])).toEqual([
      ['Detergente', 'busqueda', '200', null, 3],
      ['azúcar', 'fallida', null, 'no_encontrado', 1],
      ['azúcar', 'fallida', null, 'error', 1],
      ['Detergente', 'busqueda', '201', null, 1],
      ['sal', 'busqueda', '300', null, 1],
      ['sal', 'fallida', '300', null, 1],
    ])
  })
})

describe('saveBasketResult', () => {
  type OrderRow = typeof shopOrders.$inferSelect
  /** Base de datos falsa: el hogar del usuario, el pedido y lo que se escribe en él. */
  function fakeDb(row: OrderRow) {
    const writes: Array<Partial<OrderRow>> = []
    const db = {
      select: () => ({ from: (table: unknown) => ({ where: () => ({ limit: async () => (table === users ? [{ primaryHouseholdId: row.householdId }] : [row]) }) }) }),
      update: () => ({
        set: (values: Partial<OrderRow>) => {
          writes.push(values)
          return { where: () => ({ returning: async () => [{ ...row, ...values }] }) }
        },
      }),
    }
    return { db: db as any, writes }
  }
  const input = (key: string, name: string, over: Partial<Parameters<typeof buildLine>[0]> = {}) =>
    buildLine({ key, sourceItemIds: [`id-${key}`], ingredientId: null, name, quantity: 400, unit: 'g', quantitySource: 'recipe', notes: [], note: null, choice: null, included: true, ...over }, 'supermercado', {}, {})
  const lines = [
    input('l1', 'Jamón', { quantity: 100, choice: 'serrano' }),
    input('l2', 'alubias', {
      quantity: 800,
      members: [
        { name: 'alubias blancas', quantity: 400, unit: 'g', sourceItemIds: ['a'] },
        { name: 'alubias rojas', quantity: 400, unit: 'g', sourceItemIds: ['b'] },
      ],
    }),
    input('l3', 'sal', { included: false }),
  ]
  const row: OrderRow = {
    id: 'o1',
    householdId: 'hh1',
    userId: 'u1',
    shopId: 's1',
    shopSnapshot: { name: 'Súper', kind: 'supermercado', channel: 'web', whatsapp: null, email: null, webUrl: 'https://super.example/', phone: null, deliveryMinEur: null, deliveryFeeEur: null },
    status: 'draft',
    token: 'tok',
    lines,
    estimateEur: null,
    capEur: null,
    messageText: '',
    fulfilment: 'recoger',
    address: null,
    shopReplyText: null,
    quoteSummary: null,
    confirmationText: null,
    finalTotalEur: null,
    extensionResult: null,
    createdAt: NOW,
    updatedAt: NOW,
    sentAt: null,
    quotedAt: null,
    approvedAt: null,
    closedAt: null,
  }

  it('guarda con el resultado la foto de la cesta del pedido: clave, nombre y elección de cada línea', async () => {
    const { db, writes } = fakeDb(row)
    const r = await saveBasketResult('u1', 'o1', okResult(), db)
    expect(r).toMatchObject({ deshecho: false, guardado: true })
    expect(r.order.status).toBe('sent')
    expect(writes).toHaveLength(1)
    const cesta = [
      { key: 'l1', name: 'Jamón', choice: 'serrano' },
      { key: 'l2.1', name: 'alubias blancas', choice: null },
      { key: 'l2.2', name: 'alubias rojas', choice: null },
    ]
    expect((writes[0].extensionResult as StoredBasketResult).cesta).toEqual(cesta)
    expect(r.order.extensionResult?.cesta).toEqual(cesta)
  })
})
