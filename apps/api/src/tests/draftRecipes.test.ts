/**
 * PRO-1119 (D-164.1): `/admin/metrics` → `recipes: { draft, draftByBatch }`,
 * las recetas que esperan en borrador el visto bueno de Miguel, por lote.
 * Recetas inventadas (en borrador y publicadas) en una base de mentira que
 * hace el mismo WHERE y GROUP BY que la consulta; la base real, en
 * draftRecipes.smoke.ts.
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

/** Las recetas de la base de mentira. */
let recipeRows: Array<{ name: string; status: 'draft' | 'published'; import_batch: string | null }> = []
let lastDraftSql = ''

vi.mock('../db/connection.js', () => {
  const dialect = new PgDialect()
  const execute = async (q: any) => {
    const text = dialect.sqlToQuery(q).sql
    if (text.includes('FROM recipes WHERE status')) {
      lastDraftSql = text
      const counts = new Map<string | null, number>()
      for (const r of recipeRows.filter((r) => r.status === 'draft')) counts.set(r.import_batch, (counts.get(r.import_batch) ?? 0) + 1)
      // pg devuelve los recuentos como texto si no se castean: el mapper aguanta los dos.
      return { rows: [...counts].map(([batch, n]) => ({ batch, n: String(n) })) }
    }
    return { rows: [] }
  }
  return { db: { execute }, pool: {} }
})

const { NO_BATCH, toDraftRecipesSummary } = await import('../services/draftRecipes.js')

describe('toDraftRecipesSummary', () => {
  it('suma por lote, con `sin-lote` para los que no tienen', () => {
    expect(
      toDraftRecipesSummary([
        { batch: 'cocina-2026-11-04', n: 3 },
        { batch: 'libro-arguinano', n: '2' },
        { batch: null, n: 1 },
        { batch: '', n: 1 },
      ]),
    ).toEqual({ draft: 7, draftByBatch: { 'cocina-2026-11-04': 3, 'libro-arguinano': 2, [NO_BATCH]: 2 } })
  })

  it('sin borradores: cero y sin lotes', () => {
    expect(toDraftRecipesSummary([])).toEqual({ draft: 0, draftByBatch: {} })
    expect(toDraftRecipesSummary([{ batch: 'x', n: 0 }])).toEqual({ draft: 0, draftByBatch: {} })
  })
})

describe('GET /admin/metrics → recipes (con x-metrics-token)', () => {
  let server: Server
  let base = ''
  let previousToken = ''

  beforeAll(async () => {
    const { env } = await import('../config/env.js')
    const { default: metricsRouter } = await import('../routes/metrics.js')
    previousToken = env.METRICS_READ_TOKEN
    env.METRICS_READ_TOKEN = 'draft-recipes-test-token'
    const app = express()
    app.use(metricsRouter)
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s))
    })
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    const { env } = await import('../config/env.js')
    env.METRICS_READ_TOKEN = previousToken
    server?.closeAllConnections()
    server?.close()
  })

  const metrics = async () => {
    const res = await fetch(`${base}/admin/metrics?weeks=1`, { headers: { 'x-metrics-token': 'draft-recipes-test-token' } })
    expect(res.status).toBe(200)
    return ((await res.json()) as any).recipes
  }

  it('cuenta solo los borradores, por lote; las publicadas no', async () => {
    recipeRows = [
      { name: 'Lentejas con chorizo', status: 'draft', import_batch: 'cocina-2026-11-04' },
      { name: 'Merluza en salsa verde', status: 'draft', import_batch: 'cocina-2026-11-04' },
      { name: 'Crema de calabaza', status: 'draft', import_batch: 'libro-arguinano' },
      { name: 'Tortilla de patatas', status: 'published', import_batch: 'cocina-2026-11-04' },
      { name: 'Pollo al horno', status: 'published', import_batch: null },
      { name: 'Gazpacho', status: 'published', import_batch: 'cocina-2026-10-30' },
    ]
    const recipes = await metrics()
    expect(lastDraftSql).toContain("status = 'draft'")
    expect(recipes).toEqual({ draft: 3, draftByBatch: { 'cocina-2026-11-04': 2, 'libro-arguinano': 1 } })
    // Solo recuentos y nombres de lote: ni nombres de receta ni ids.
    expect(JSON.stringify(recipes)).not.toMatch(/Lentejas|Merluza|Crema|Tortilla/)
  })

  it('todo publicado: draft 0 y draftByBatch vacío', async () => {
    recipeRows = [{ name: 'Gazpacho', status: 'published', import_batch: 'cocina-2026-10-30' }]
    expect(await metrics()).toEqual({ draft: 0, draftByBatch: {} })
  })
})
