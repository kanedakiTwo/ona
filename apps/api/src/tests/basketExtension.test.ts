/**
 * «Enviar la cesta a la extensión del navegador» (specs/shop-orders.md):
 * el esquema del resultado, la lista de emails y qué hace la API con cada resultado.
 *
 * Run: pnpm --filter @ona/api test src/tests/basketExtension.test.ts
 */
import { describe, it, expect } from 'vitest'
import { basketSendResultSchema, type BasketSendResult, type ShopOrderLine, type ShoppingItem, type StoredBasketResult } from '@ona/shared'
import { aggregateBasketGaps, decideBasketResult, isBasketExtensionAllowed } from '../services/basketExtension.js'
import { closeOrder, saveBasketResult, undoBasketSend } from '../services/shopOrders/store.js'
import { buildLine } from '../services/shopOrders/lines.js'
import { shopOrders, shoppingLists, users } from '../db/schema.js'
import { basketSentProps, sanitizeProps } from '../services/usageEvents.js'

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

// ─── El pedido en la base de datos (falsa: sin conexión) ─────────────────

type OrderRow = typeof shopOrders.$inferSelect
type ListRow = { id: string; items: ShoppingItem[] }
/**
 * Base de datos falsa para las funciones del store: el hogar del usuario, el
 * pedido, la última lista de la compra y lo que se escribe en cada tabla.
 * `log` apunta, en orden, la transacción y cada lectura o escritura del pedido
 * y de la lista: por dónde va (`db` o la transacción, `tx`) y si la lectura
 * bloquea la fila. Con `row` null, el pedido no está (otro hogar o borrado).
 */
function fakeDb(row: OrderRow | null, list: ListRow | null = null) {
  const writes: Array<{ table: unknown; values: Record<string, unknown> }> = []
  const log: string[] = []
  const rowsOf = (table: unknown) =>
    table === users ? [{ primaryHouseholdId: row?.householdId ?? 'hh1' }] : table === shoppingLists ? (list ? [list] : []) : row ? [row] : []
  const client = (via: 'db' | 'tx') => ({
    select: () => ({
      from: (table: unknown) => {
        let lock = ''
        const q: any = {
          where: () => q,
          orderBy: () => q,
          limit: () => q,
          for: (strength: string) => {
            lock = ` for ${strength}`
            return q
          },
          then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
            if (table === shopOrders) log.push(`${via}: leer el pedido${lock}`)
            if (table === shoppingLists) log.push(`${via}: leer la lista`)
            return Promise.resolve(rowsOf(table)).then(ok, ko)
          },
        }
        return q
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        writes.push({ table, values })
        if (table === shopOrders) log.push(`${via}: escribir el pedido`)
        if (table === shoppingLists) log.push(`${via}: tachar la lista`)
        return { where: () => ({ returning: async () => [{ ...row, ...values }] }) }
      },
    }),
  })
  const db = {
    ...client('db'),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      log.push('begin')
      try {
        const out = await fn(client('tx'))
        log.push('commit')
        return out
      } catch (e) {
        log.push('rollback')
        throw e
      }
    },
  }
  return {
    db: db as any,
    log,
    /** Lo escrito en el pedido. */
    orderWrites: () => writes.filter((w) => w.table === shopOrders).map((w) => w.values as Partial<OrderRow>),
    /** Los artículos tachados en la lista, o null si no se escribió. */
    checked: () => {
      const w = writes.find((x) => x.table === shoppingLists)
      return w ? (w.values.items as ShoppingItem[]).filter((i) => i.checked).map((i) => i.id).sort() : null
    },
  }
}
const input = (key: string, name: string, over: Partial<Parameters<typeof buildLine>[0]> = {}) =>
  buildLine({ key, sourceItemIds: [`id-${key}`], ingredientId: null, name, quantity: 400, unit: 'g', quantitySource: 'recipe', notes: [], note: null, choice: null, included: true, ...over }, 'supermercado', {}, {})
const lines = [
  input('l1', 'Jamón', { quantity: 100, choice: 'serrano' }),
  input('l2', 'alubias', {
    sourceItemIds: ['a', 'b'],
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

describe('saveBasketResult', () => {
  it('guarda con el resultado la foto de la cesta del pedido: clave, nombre y elección de cada línea', async () => {
    const { db, orderWrites } = fakeDb(row)
    const r = await saveBasketResult('u1', 'o1', okResult(), db)
    expect(r).toMatchObject({ deshecho: false, guardado: true })
    expect(r.order.status).toBe('sent')
    expect(orderWrites()).toHaveLength(1)
    const cesta = [
      { key: 'l1', name: 'Jamón', choice: 'serrano' },
      { key: 'l2.1', name: 'alubias blancas', choice: null },
      { key: 'l2.2', name: 'alubias rojas', choice: null },
    ]
    expect((orderWrites()[0].extensionResult as StoredBasketResult).cesta).toEqual(cesta)
    expect(r.order.extensionResult?.cesta).toEqual(cesta)
  })
  const fallo = okResult({ envioId: '', ok: false, error: 'sin_sesion', lineas: [], anadidas: 0, totalEur: null })
  it('el mismo envioId otra vez: guardado false y no escribe', async () => {
    const f = fakeDb({ ...row, status: 'sent', sentAt: NOW, extensionResult: stored() })
    expect(await saveBasketResult('u1', 'o1', okResult({ repetido: true }), f.db)).toMatchObject({ deshecho: false, guardado: false })
    expect(f.orderWrites()).toHaveLength(0)
  })
  it('un repetido de un envío deshecho: deshecho true, guardado false y no escribe', async () => {
    const f = fakeDb({ ...row, extensionResult: stored({ deshechoAt: NOW.toISOString(), deshechos: ['e1'] }) })
    expect(await saveBasketResult('u1', 'o1', okResult({ repetido: true }), f.db)).toMatchObject({ deshecho: true, guardado: false })
    expect(f.orderWrites()).toHaveLength(0)
  })
  it('un fallo antes de escribir en borrador: se guarda y cuenta, pero sigue en borrador sin sentAt', async () => {
    const f = fakeDb(row)
    const r = await saveBasketResult('u1', 'o1', fallo, f.db)
    expect(r).toMatchObject({ deshecho: false, guardado: true, order: { status: 'draft', sentAt: null } })
    expect(f.orderWrites()[0]).toMatchObject({ status: 'draft', sentAt: null })
  })
  it('un pedido en sent (marcado como enviado a mano) conserva su sentAt', async () => {
    const f = fakeDb({ ...row, status: 'sent', sentAt: NOW })
    const r = await saveBasketResult('u1', 'o1', okResult(), f.db)
    expect(r).toMatchObject({ guardado: true, order: { status: 'sent', sentAt: NOW.toISOString() } })
  })
  it('solo para el súper (una frutería: 400 NOT_SUPER) y no en un pedido cerrado (409 BAD_STATUS); sin escribir', async () => {
    const fruteria = fakeDb({ ...row, shopSnapshot: { ...(row.shopSnapshot as object), kind: 'fruteria' } })
    await expect(saveBasketResult('u1', 'o1', okResult(), fruteria.db)).rejects.toMatchObject({ status: 400, code: 'NOT_SUPER' })
    expect(fruteria.orderWrites()).toHaveLength(0)
    const cerrado = fakeDb({ ...row, status: 'closed' })
    await expect(saveBasketResult('u1', 'o1', okResult(), cerrado.db)).rejects.toMatchObject({ status: 409, code: 'BAD_STATUS' })
    expect(cerrado.orderWrites()).toHaveLength(0)
  })
})

describe('closeOrder con la extensión', () => {
  /** El pedido enviado: jamón, alubias blancas y rojas (fusionadas), sal (excluida), arroz, leche y detergente. */
  const sentRow = (extensionResult: StoredBasketResult | null): OrderRow => ({
    ...row,
    status: 'sent',
    sentAt: NOW,
    lines: [...lines, input('l4', 'arroz'), input('l5', 'leche'), input('l6', 'detergente')],
    extensionResult,
  })
  const list = (): ListRow => ({
    id: 'list1',
    items: ['id-l1', 'a', 'b', 'id-l3', 'id-l4', 'id-l5', 'id-l6', 'otro'].map((id) => ({ id, name: id, checked: false }) as unknown as ShoppingItem),
  })
  const vivo = stored({
    envioId: 'e1',
    anadidas: 3,
    lineas: [
      { key: 'l1', estado: 'tabla', productoId: '1', unidades: 1 },
      { key: 'l2.1', estado: 'tabla', productoId: '2', unidades: 1 },
      { key: 'l2.2', estado: 'fallida', motivo: 'no_encontrado' },
      { key: 'l4', estado: 'busqueda', productoId: '4', unidades: 1 },
      { key: 'l5', estado: 'no_verificada', productoId: '5' },
      { key: 'l6', estado: 'fallida', motivo: 'no_encontrado' },
    ],
  })
  const close = async (extensionResult: StoredBasketResult | null) => {
    const f = fakeDb(sentRow(extensionResult), list())
    const order = await closeOrder('u1', 'o1', {}, f.db)
    expect(order.status).toBe('closed')
    return f.checked()
  }

  it('con un envío vivo tacha lo que llegó como tabla o búsqueda', async () => {
    expect(await close(vivo)).toEqual(expect.arrayContaining(['id-l1', 'id-l4']))
  })
  it('con un envío vivo deja pendiente lo fallido y lo no verificado', async () => {
    const checked = await close(vivo)
    expect(checked).not.toContain('id-l6')
    expect(checked).not.toContain('id-l5')
  })
  it('en una línea fusionada en la que entró l2.1 y falló l2.2, tacha solo los artículos de l2.1', async () => {
    const checked = await close(vivo)
    expect(checked).toContain('a')
    expect(checked).not.toContain('b')
    expect(checked).toEqual(['a', 'id-l1', 'id-l4'])
  })
  it('con un envío deshecho, uno sin nada en el carro o sin resultado, tacha como antes: todas las líneas incluidas', async () => {
    const antes = ['a', 'b', 'id-l1', 'id-l4', 'id-l5', 'id-l6']
    expect(await close(null)).toEqual(antes)
    expect(await close({ ...vivo, deshechoAt: '2026-10-19T10:30:00.000Z', deshechos: ['e1'] })).toEqual(antes)
    expect(await close(stored({ envioId: '', ok: false, error: 'red', lineas: [], anadidas: 0 }))).toEqual(antes)
  })
})

describe('undoBasketSend', () => {
  const vivo = stored({ envioId: 'e2', deshechos: ['e1'] })
  const sentRow: OrderRow = { ...row, status: 'sent', sentAt: NOW, extensionResult: vivo }

  it('marca deshechoAt y añade el envioId a deshechos, sin tocar el resto del resultado', async () => {
    const { db, orderWrites } = fakeDb(sentRow)
    const order = await undoBasketSend('u1', 'o1', db)
    const r = orderWrites()[0].extensionResult as StoredBasketResult
    expect(r.deshechoAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(r.deshechos).toEqual(['e1', 'e2'])
    expect(r).toEqual({ ...vivo, deshechoAt: r.deshechoAt, deshechos: ['e1', 'e2'] })
    expect(order.extensionResult?.deshechos).toEqual(['e1', 'e2'])
  })
  it('vuelve a borrador sin sentAt y no toca nada más del pedido', async () => {
    const { db, orderWrites } = fakeDb(sentRow)
    const order = await undoBasketSend('u1', 'o1', db)
    expect(orderWrites()).toHaveLength(1)
    expect(Object.keys(orderWrites()[0]).sort()).toEqual(['extensionResult', 'sentAt', 'status', 'updatedAt'])
    expect(orderWrites()[0]).toMatchObject({ status: 'draft', sentAt: null })
    expect(order).toMatchObject({ status: 'draft', sentAt: null })
    expect(order.lines).toEqual(lines)
  })
  it('deshacer un pedido enviado a mano con un envío fallido (nada en el carro): 409 NO_EXTENSION_SEND, sin escribir', async () => {
    const fallido = stored({ envioId: '', ok: false, error: 'sin_sesion', lineas: [], anadidas: 0, totalEur: null })
    const f = fakeDb({ ...row, status: 'sent', sentAt: NOW, extensionResult: fallido })
    await expect(undoBasketSend('u1', 'o1', f.db)).rejects.toMatchObject({ status: 409, code: 'NO_EXTENSION_SEND' })
    expect(f.orderWrites()).toHaveLength(0)
  })
  it('un segundo deshacer no rompe nada: 409 y no se escribe otra vez', async () => {
    const first = fakeDb(sentRow)
    await undoBasketSend('u1', 'o1', first.db)
    const after = { ...sentRow, ...first.orderWrites()[0] } as OrderRow
    const second = fakeDb(after)
    await expect(undoBasketSend('u1', 'o1', second.db)).rejects.toMatchObject({ name: 'ShopOrderError', status: 409 })
    expect(second.orderWrites()).toHaveLength(0)
    // Aunque el pedido haya vuelto a «Enviado» a mano, un envío ya deshecho no se deshace dos veces.
    const resent = fakeDb({ ...after, status: 'sent', sentAt: NOW })
    await expect(undoBasketSend('u1', 'o1', resent.db)).rejects.toMatchObject({ status: 409, code: 'NO_EXTENSION_SEND' })
    expect(resent.orderWrites()).toHaveLength(0)
  })
})

describe('resultado, deshacer y cerrar, sin carreras', () => {
  const LOCKED = ['begin', 'tx: leer el pedido for update']
  it('saveBasketResult lee el pedido bloqueado (FOR UPDATE) y escribe en la misma transacción', async () => {
    const f = fakeDb(row)
    await saveBasketResult('u1', 'o1', okResult(), f.db)
    expect(f.log).toEqual([...LOCKED, 'tx: escribir el pedido', 'commit'])
  })
  it('también decide con la fila bloqueada cuando no escribe (el mismo envío otra vez)', async () => {
    const f = fakeDb({ ...row, status: 'sent', sentAt: NOW, extensionResult: stored() })
    expect(await saveBasketResult('u1', 'o1', okResult({ repetido: true }), f.db)).toMatchObject({ guardado: false })
    expect(f.log).toEqual([...LOCKED, 'commit'])
  })
  it('undoBasketSend lee el pedido bloqueado y escribe en la misma transacción; si no puede, no escribe', async () => {
    const f = fakeDb({ ...row, status: 'sent', sentAt: NOW, extensionResult: stored() })
    await undoBasketSend('u1', 'o1', f.db)
    expect(f.log).toEqual([...LOCKED, 'tx: escribir el pedido', 'commit'])
    const g = fakeDb({ ...row, status: 'sent', sentAt: NOW, extensionResult: stored({ deshechoAt: NOW.toISOString(), deshechos: ['e1'] }) })
    await expect(undoBasketSend('u1', 'o1', g.db)).rejects.toMatchObject({ status: 409 })
    expect(g.log).toEqual([...LOCKED, 'rollback'])
  })
  it('closeOrder lee el pedido bloqueado, y tacha la lista y cierra el pedido en la misma transacción', async () => {
    const list: ListRow = { id: 'list1', items: [{ id: 'id-l1', name: 'jamón', checked: false } as unknown as ShoppingItem] }
    const f = fakeDb({ ...row, status: 'sent', sentAt: NOW, extensionResult: stored() }, list)
    expect((await closeOrder('u1', 'o1', {}, f.db)).status).toBe('closed')
    expect(f.log).toEqual([...LOCKED, 'tx: leer la lista', 'tx: tachar la lista', 'tx: escribir el pedido', 'commit'])
    expect(f.checked()).toEqual(['id-l1'])
  })
  it('closeOrder de un pedido ya cerrado: 409 con la fila bloqueada, sin escribir', async () => {
    const f = fakeDb({ ...row, status: 'closed' })
    await expect(closeOrder('u1', 'o1', {}, f.db)).rejects.toMatchObject({ status: 409, code: 'BAD_STATUS' })
    expect(f.log).toEqual([...LOCKED, 'rollback'])
  })
  it('sin el pedido (otro hogar o borrado): guardar, deshacer y cerrar dan 404 NOT_FOUND, no 500, y no escriben', async () => {
    const calls: Array<[string, (db: any) => Promise<unknown>]> = [
      ['guardar', (db) => saveBasketResult('u1', 'o1', okResult(), db)],
      ['deshacer', (db) => undoBasketSend('u1', 'o1', db)],
      ['cerrar', (db) => closeOrder('u1', 'o1', {}, db)],
    ]
    for (const [what, call] of calls) {
      const f = fakeDb(null)
      await expect(call(f.db), what).rejects.toMatchObject({ name: 'ShopOrderError', status: 404, code: 'NOT_FOUND' })
      expect(f.log, what).toEqual([...LOCKED, 'rollback'])
      expect(f.orderWrites(), what).toHaveLength(0)
    }
  })
})

describe('basketSentProps', () => {
  it('solo recuentos y códigos, nunca nombres de productos, y cabe en sanitizeProps', () => {
    const props = basketSentProps(okResult({ lineas: [
      { key: 'l1', estado: 'tabla', producto: 'Arroz' },
      { key: 'l2', estado: 'busqueda' },
      { key: 'l3', estado: 'fallida', motivo: 'no_encontrado' },
      { key: 'l4', estado: 'no_verificada' },
    ], anadidas: 2 }))
    expect(props).toEqual({ lineas: 4, tabla: 1, busqueda: 1, fallidas: 2, ok: true, error: 'ninguno', bajoMinimo: true })
    expect(sanitizeProps(props)).toEqual(props)
  })
})
