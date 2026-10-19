/**
 * «Enviar la cesta a la extensión del navegador» (specs/shop-orders.md):
 * el esquema del resultado, la lista de emails y qué hace la API con cada resultado.
 *
 * Run: pnpm --filter @ona/api test src/tests/basketExtension.test.ts
 */
import { describe, it, expect } from 'vitest'
import { basketSendResultSchema, type BasketSendResult } from '@ona/shared'

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
})
