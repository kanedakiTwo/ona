/**
 * PRO-1025 — GET /admin/feature-usage (specs/feature-usage.md «Uso de
 * funciones»): una fila por función, solo cifras, y «menos de 5» en los
 * grupos pequeños. Router de métricas y metricsAuth de verdad en un puerto
 * efímero; la base de datos es un stub que contesta las dos consultas con
 * filas fijas (con un id de hogar y un texto de más, que no deben salir).
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { FEATURE_CATALOG } from '@ona/shared'

const HH = '5b1f0c2e-7a3d-4e8f-9c1b-2d3e4f5a6b7c'
const queries: Array<{ sql: string; params: unknown[] }> = []

vi.mock('../db/connection.js', () => {
  const dialect = new PgDialect()
  const execute = async (q: any) => {
    const { sql: text, params } = dialect.sqlToQuery(q)
    queries.push({ sql: text, params })
    if (text.includes('FROM household_feature_usage')) {
      return {
        rows: [
          // 40 hogares han hecho menú; 30 este mes.
          { feature: 'menu_semanal', units: 40, households: 40, active: 30, uses_30d: 120, uses_total: '900', median_days: 3.4, counted_until: '2026-10-29T23:00:00.000Z', household_id: HH, nota: 'Ana García' },
          // Solo 3 hogares guardan recetas desde una foto.
          { feature: 'receta_foto', units: 3, households: 3, active: 2, uses_30d: 7, uses_total: '11', median_days: 9, counted_until: '2026-10-29T23:00:00.000Z' },
          // Mimo en la app, por persona: 12 personas de 9 hogares.
          { feature: 'mimo_chat', units: 12, households: 9, active: 8, uses_30d: 60, uses_total: '300', median_days: 1, counted_until: '2026-10-29T23:00:00.000Z' },
          // Una función que ya no está en el catálogo: no sale.
          { feature: 'retirada', units: 50, households: 50, active: 50, uses_30d: 1, uses_total: '1', median_days: 1, counted_until: null },
        ],
      }
    }
    if (text.includes('FROM household_members')) return { rows: [{ households: 42, people: 60 }] }
    return { rows: [] }
  }
  return { db: { execute } }
})

const { env } = await import('../config/env.js')
const { default: metricsRouter } = await import('../routes/metrics.js')
const { buildFeatureUsageReport, smallCell } = await import('../services/featureUsageReport.js')

let server: Server
let base = ''
const previousToken = env.METRICS_READ_TOKEN
const TOKEN = { 'x-metrics-token': 'feature-usage-test-token' }

beforeAll(async () => {
  env.METRICS_READ_TOKEN = 'feature-usage-test-token'
  const app = express()
  app.use(metricsRouter)
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  env.METRICS_READ_TOKEN = previousToken
  server?.closeAllConnections()
  server?.close()
})

async function get(path: string) {
  const res = await fetch(`${base}${path}`, { headers: TOKEN })
  return { status: res.status, body: (await res.json()) as any }
}

describe('GET /admin/feature-usage', () => {
  it('está cerrada sin credenciales', async () => {
    expect((await fetch(`${base}/admin/feature-usage`)).status).toBe(401)
  })

  it('con el token: una fila por función del catálogo, en su orden', async () => {
    const { status, body } = await get('/admin/feature-usage')
    expect(status).toBe(200)
    expect(body.days).toBe(30)
    expect(body.features.map((f: any) => f.id)).toEqual(FEATURE_CATALOG.map((f) => f.id))
    expect(body.base).toEqual({ households: 42, people: 60 })
    expect(body.countedUntil).toBe('2026-10-29T23:00:00.000Z')
    const menu = body.features.find((f: any) => f.id === 'menu_semanal')
    expect(menu).toMatchObject({
      nombre: 'Menú de la semana',
      unit: 'hogares',
      users: 40,
      active: 30,
      lapsed: 10,
      never: 'menos de 5',
      uses30d: 120,
      usesTotal: 900,
      medianDaysSinceLast: 3,
      share: 0.952,
    })
    // Por persona: la base es la de personas.
    expect(body.features.find((f: any) => f.id === 'mimo_chat')).toMatchObject({ unit: 'personas', users: 12, households: 9, never: 48 })
    // Sin filas: ceros, y toda la base sin usarla.
    expect(body.features.find((f: any) => f.id === 'modo_cocina')).toMatchObject({ users: 0, active: 0, uses30d: 0, never: 42, medianDaysSinceLast: null, share: 0 })
  })

  it('una celda con 3 hogares sale «menos de 5», con sus usos', async () => {
    const { body } = await get('/admin/feature-usage')
    const foto = body.features.find((f: any) => f.id === 'receta_foto')
    expect(foto).toMatchObject({
      users: 'menos de 5',
      active: 'menos de 5',
      lapsed: 'menos de 5',
      households: 'menos de 5',
      uses30d: 'menos de 5',
      usesTotal: 'menos de 5',
      medianDaysSinceLast: 'menos de 5',
      share: null,
      never: 39,
    })
    expect(body.tricks.find((t: any) => t.id === 'receta_foto')).toEqual({
      id: 'receta_foto',
      nombre: 'Guardar una receta desde una foto',
      per: 'hogar',
      unit: 'hogares',
      never: 39,
      lapsed: 'menos de 5',
    })
  })

  it('nunca ids ni textos: solo cifras, el catálogo y las definiciones', async () => {
    const { body } = await get('/admin/feature-usage?includeInternal=1')
    const raw = JSON.stringify(body)
    expect(raw).not.toContain(HH)
    expect(raw).not.toMatch(/Ana|García|household_id|user_id|retirada/)
    expect(raw).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
    const keys = new Set(body.features.flatMap((f: any) => Object.keys(f)))
    expect([...keys].sort()).toEqual(
      ['active', 'households', 'id', 'kind', 'lapsed', 'medianDaysSinceLast', 'never', 'nombre', 'per', 'share', 'unit', 'users', 'uses30d', 'usesTotal'],
    )
  })

  it('los trucos: de más a menos gente que no la ha usado nunca', async () => {
    const { body } = await get('/admin/feature-usage')
    const never = body.tricks.map((t: any) => (typeof t.never === 'number' ? t.never : 0))
    expect(never).toEqual([...never].sort((a: number, b: number) => b - a))
    // Las de persona primero (60 personas sin usarla), después las del hogar.
    expect(body.tricks[0]).toMatchObject({ per: 'persona', never: 60 })
  })

  it('days se acota a 1–180 y la ventana va hasta las 00:00 de hoy', async () => {
    queries.length = 0
    expect((await get('/admin/feature-usage?days=999')).body.days).toBe(180)
    expect((await get('/admin/feature-usage?days=0')).body.days).toBe(1)
    expect((await get('/admin/feature-usage?days=abc')).body.days).toBe(30)
    // Sin includeInternal: fuera las cuentas de admin y las suspendidas.
    const q = queries.find((x) => x.sql.includes('FROM household_feature_usage'))!
    expect(q.sql).toContain("role <> 'admin'")
    expect(q.params).toContain(false)
  })
})

describe('buildFeatureUsageReport (puro)', () => {
  it('smallCell: 0 y 5 o más, la cifra; de 1 a 4, «menos de 5»', () => {
    expect([0, 1, 4, 5, 37].map(smallCell)).toEqual([0, 'menos de 5', 'menos de 5', 5, 37])
  })

  it('la base pequeña también sale recortada', () => {
    const r = buildFeatureUsageReport({ households: 3, people: 4 }, [])
    expect(r.base).toEqual({ households: 'menos de 5', people: 'menos de 5' })
    expect(r.features.every((f) => f.never === 'menos de 5')).toBe(true)
  })

  it('una función que usa toda la base no sale en los trucos', () => {
    const r = buildFeatureUsageReport({ households: 10, people: 10 }, [
      { feature: 'menu_semanal', units: 10, households: 10, active: 10, uses30d: 40, usesTotal: 40, medianDaysSinceLast: 2 },
    ])
    expect(r.tricks.find((t) => t.id === 'menu_semanal')).toBeUndefined()
    expect(r.features[0]).toMatchObject({ users: 10, never: 0, lapsed: 0, share: 1 })
  })
})
