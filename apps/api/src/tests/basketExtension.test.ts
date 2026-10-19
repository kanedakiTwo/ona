/**
 * «Enviar la cesta a la extensión del navegador» (specs/shop-orders.md):
 * el esquema del resultado, la lista de emails y qué hace la API con cada resultado.
 *
 * Run: pnpm --filter @ona/api test src/tests/basketExtension.test.ts
 */
import { describe, it, expect } from 'vitest'
import { basketSendResultSchema, type BasketSendResult, type ShopOrderLine, type StoredBasketResult } from '@ona/shared'
import { aggregateBasketGaps, decideBasketResult, isBasketExtensionAllowed } from '../services/basketExtension.js'

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
    expect(gaps).toEqual([{ name: 'detergente', choice: null, search: 'detergente', estado: 'busqueda', productoId: '200', producto: 'Detergente', veces: 2 }])
  })
})
