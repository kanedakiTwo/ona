/**
 * «Cocinar ahora» (specs/cook-now.md): the routes Cocina uses to mark
 * catalogue ingredients. The body schema, the foreign-row guard, and the
 * real router on an ephemeral port with a fake db that records the WHERE of
 * each query, to prove households' own recipes never reach the office (E-40).
 *
 * Run: pnpm --filter @ona/api exec vitest run src/tests/ingredientRolesRoute.test.ts
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const wheres: SQL[] = []
let rows: unknown[] = []

/** A query chain that records every `.where(…)` and resolves to `rows`. */
function chain(): any {
  const q: any = {
    from: () => q,
    innerJoin: () => q,
    where: (cond: SQL) => {
      wheres.push(cond)
      return q
    },
    orderBy: () => q,
    limit: () => q,
    then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(rows).then(ok, ko),
  }
  return q
}

vi.mock('../db/connection.js', () => ({
  db: {
    select: () => chain(),
    selectDistinct: () => chain(),
    transaction: async () => {
      throw new Error('no writes expected')
    },
  },
}))
vi.mock('../middleware/cocinaAuth.js', () => ({ cocinaAuth: (_req: any, _res: any, next: any) => next() }))

const { default: router, foreignRowIds } = await import('../routes/ingredientRoles.js')
const { ingredientRolesUpdateSchema } = await import('@ona/shared')

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const dialect = new PgDialect()
const sqlOf = (cond: SQL) => dialect.sqlToQuery(cond).sql

let server: Server
let base = ''

beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use(router)
  server = app.listen(0)
  await new Promise<void>((r) => server.once('listening', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})
beforeEach(() => {
  wheres.length = 0
  rows = []
})

describe('PUT /admin/recipes/:id/ingredient-roles body', () => {
  it('accepts marks with substitutes', () => {
    expect(ingredientRolesUpdateSchema.safeParse([{ recipeIngredientId: id(1), role: 'essential', substituteIngredientIds: [id(2)] }]).success).toBe(true)
  })
  it('rejects an unknown role and an empty list', () => {
    expect(ingredientRolesUpdateSchema.safeParse([{ recipeIngredientId: id(1), role: 'clave' }]).success).toBe(false)
    expect(ingredientRolesUpdateSchema.safeParse([]).success).toBe(false)
  })
  it('flags rows that are not of the recipe', () => {
    expect(foreignRowIds([id(1), id(3)], new Set([id(1), id(2)]))).toEqual([id(3)])
  })
})

describe('only catalogue recipes reach the office', () => {
  it('the pending list asks for recipes with no author and that are not a copy', async () => {
    const r = await fetch(`${base}/admin/recipes/ingredient-roles/pending`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual([])
    expect(wheres).toHaveLength(1)
    const where = sqlOf(wheres[0])
    expect(where).toContain('"recipes"."author_id" is null')
    expect(where).toContain('"recipes"."copied_from_recipe_id" is null')
    expect(where).toContain('"recipe_ingredients"."role" is null')
  })

  it('marking a recipe that is not of the catalogue is a 404 and writes nothing', async () => {
    const r = await fetch(`${base}/admin/recipes/${id(9)}/ingredient-roles`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ recipeIngredientId: id(1), role: 'essential' }]),
    })
    expect(r.status).toBe(404)
    const where = sqlOf(wheres[0])
    expect(where).toContain('"recipes"."author_id" is null')
    expect(where).toContain('"recipes"."copied_from_recipe_id" is null')
  })

  it('a bad body is a 400 before reading anything', async () => {
    const r = await fetch(`${base}/admin/recipes/${id(9)}/ingredient-roles`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ recipeIngredientId: id(1), role: 'clave' }]),
    })
    expect(r.status).toBe(400)
    expect(wheres).toHaveLength(0)
  })
})
