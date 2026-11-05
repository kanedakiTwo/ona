/**
 * PRO-1120 — GET /admin/recipe-usage (specs/metrics.md «Uso por receta»): por
 * receta del catálogo, veces en un menú, cambiada y cocinada, sin hogares
 * (D-094). Menús inventados para el recuento puro; para la ruta, el router de
 * métricas y metricsAuth de verdad en un puerto efímero, con una base de
 * datos stub que contesta cada consulta con filas fijas (con un id de hogar
 * de más, que no debe salir).
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

const HH = '5b1f0c2e-7a3d-4e8f-9c1b-2d3e4f5a6b7c'
const LENTEJAS = '11111111-1111-4111-8111-111111111111'
const MERLUZA = '22222222-2222-4222-8222-222222222222'
const TORTILLA = '33333333-3333-4333-8333-333333333333'
const DE_USUARIO = '44444444-4444-4444-8444-444444444444'

const recipe = (recipeId: string, variant?: string) => ({ kind: 'recipe', recipeId, ...(variant ? { variant } : {}) })
const week = (days: Array<Record<string, unknown> | null>) => ({ days: [...days, ...Array(7 - days.length).fill({})] })

/** Dos hogares inventados: lentejas tres veces (una de sobras), merluza dos, una receta suya. */
const MENUS = [
  week([
    { lunch: { dishes: [recipe(LENTEJAS)] }, dinner: { dishes: [recipe(MERLUZA), { kind: 'note', text: 'Pan' }] } },
    { lunch: { dishes: [recipe(LENTEJAS, 'leftover')] }, dinner: { dishes: [recipe(TORTILLA, 'freezer')] } },
  ]),
  week([
    { lunch: { dishes: [recipe(LENTEJAS, 'planned'), recipe(DE_USUARIO)] } },
    null,
    { dinner: { dishes: [recipe(MERLUZA)] } },
  ]),
]

const queries: Array<{ sql: string; params: unknown[] }> = []

vi.mock('../db/connection.js', () => {
  const dialect = new PgDialect()
  const execute = async (q: any) => {
    const { sql: text, params } = dialect.sqlToQuery(q)
    queries.push({ sql: text, params })
    if (text.includes('FROM menus')) return { rows: MENUS.map((m) => ({ ...m, household_id: HH })) }
    if (text.includes('FROM menu_edits')) {
      return { rows: [{ recipe_id: MERLUZA, count: 4, household_id: HH }, { recipe_id: DE_USUARIO, count: 2 }] }
    }
    if (text.includes('FROM cook_logs')) {
      return { rows: [{ recipe_id: LENTEJAS, count: 2, from_menu: 1 }, { recipe_id: TORTILLA, count: 1, from_menu: 0 }] }
    }
    if (text.includes('FROM recipes')) {
      return { rows: [{ id: LENTEJAS, name: 'Lentejas estofadas' }, { id: MERLUZA, name: 'Merluza en salsa verde' }, { id: TORTILLA, name: 'Tortilla de patata' }] }
    }
    return { rows: [] }
  }
  return { db: { execute } }
})

const { env } = await import('../config/env.js')
const { default: metricsRouter } = await import('../routes/metrics.js')
const { buildRecipeUsageReport, countMenuPlacements } = await import('../services/recipeUsageReport.js')

describe('countMenuPlacements (menús inventados)', () => {
  it('cuenta cada plato planeado, sin sobras, tápers ni notas', () => {
    const counts = countMenuPlacements(MENUS)
    expect(counts.get(LENTEJAS)).toBe(2)
    expect(counts.get(MERLUZA)).toBe(2)
    expect(counts.has(TORTILLA)).toBe(false)
    expect(counts.get(DE_USUARIO)).toBe(1)
  })

  it('aguanta menús rotos o vacíos', () => {
    expect(countMenuPlacements([{ days: null }, { days: {} }, { days: [null, { lunch: null }, { dinner: { dishes: null } }] }]).size).toBe(0)
  })
})

describe('buildRecipeUsageReport', () => {
  const names = new Map([[LENTEJAS, 'Lentejas'], [MERLUZA, 'Merluza'], [TORTILLA, 'Tortilla']])

  it('une las tres cifras, ordena por la más cambiada y deja fuera lo que no es del catálogo', () => {
    const r = buildRecipeUsageReport({
      names,
      inMenu: countMenuPlacements(MENUS),
      swappedOut: [{ recipeId: MERLUZA, count: 4 }, { recipeId: DE_USUARIO, count: 2 }],
      cooked: [{ recipeId: LENTEJAS, count: 2, fromMenu: 1 }, { recipeId: TORTILLA, count: 1, fromMenu: 0 }],
    })
    expect(r.recipes).toEqual([
      { recipeId: MERLUZA, name: 'Merluza', inMenu: 2, swappedOut: 4, cooked: 0, cookedFromMenu: 0, swapRate: 0.667 },
      { recipeId: LENTEJAS, name: 'Lentejas', inMenu: 2, swappedOut: 0, cooked: 2, cookedFromMenu: 1, swapRate: 0 },
      { recipeId: TORTILLA, name: 'Tortilla', inMenu: 0, swappedOut: 0, cooked: 1, cookedFromMenu: 0, swapRate: null },
    ])
    expect(r.totals).toEqual({ recipes: 3, inMenu: 4, swappedOut: 4, cooked: 3, cookedFromMenu: 1 })
  })

  it('sin datos, sin filas', () => {
    expect(buildRecipeUsageReport({ names, inMenu: new Map(), swappedOut: [], cooked: [] })).toEqual({
      totals: { recipes: 0, inMenu: 0, swappedOut: 0, cooked: 0, cookedFromMenu: 0 },
      recipes: [],
    })
  })
})

let server: Server
let base = ''
const previousToken = env.METRICS_READ_TOKEN
const TOKEN = { 'x-metrics-token': 'recipe-usage-test-token' }

beforeAll(async () => {
  env.METRICS_READ_TOKEN = 'recipe-usage-test-token'
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

describe('GET /admin/recipe-usage', () => {
  it('está cerrada sin credenciales', async () => {
    expect((await fetch(`${base}/admin/recipe-usage`)).status).toBe(401)
  })

  it('con el token: por receta del catálogo, nombre y cifras, sin hogares', async () => {
    queries.length = 0
    const res = await fetch(`${base}/admin/recipe-usage`, { headers: TOKEN })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.days).toBe(28)
    expect(body.includeInternal).toBe(false)
    expect(body.recipes.map((r: any) => [r.name, r.inMenu, r.swappedOut, r.cooked])).toEqual([
      ['Merluza en salsa verde', 2, 4, 0],
      ['Lentejas estofadas', 2, 0, 2],
      ['Tortilla de patata', 0, 0, 1],
    ])
    expect(JSON.stringify(body)).not.toContain(HH)
    expect(JSON.stringify(body)).not.toContain(DE_USUARIO)
    // Los nombres, solo del catálogo; la ventana, de 28 días.
    const names = queries.find((q) => q.sql.includes('FROM recipes'))!
    expect(names.sql).toContain('author_id IS NULL')
    expect(String(names.params[0]).split(',')).toHaveLength(4)
    expect(body.to).toBeTruthy()
    expect(body.from < body.to).toBe(true)
  })

  it('acota days entre 1 y 180', async () => {
    const res = await fetch(`${base}/admin/recipe-usage?days=999`, { headers: TOKEN })
    expect(((await res.json()) as any).days).toBe(180)
  })
})
