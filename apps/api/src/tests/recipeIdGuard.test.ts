/**
 * PRO-181: a recipe link with an id that isn't one (`/recipes/no-es-un-id`)
 * used to reach Postgres, fail the uuid cast and answer 500 (recorded as an
 * app error). Every `/recipes/:id...` route now answers the same 404 as a
 * recipe that doesn't exist, before touching the database, and logs nothing.
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { isRecipeId } from '../middleware/recipeId.js'

let server: Server
let base = ''

beforeAll(async () => {
  // Nothing listens here: a request that reached the database would fail.
  process.env.DATABASE_URL ??= 'postgresql://nobody:nothing@127.0.0.1:1/none'
  const { default: recipeRoutes } = await import('../routes/recipes.js')
  const a = express()
  a.use(express.json())
  a.use(recipeRoutes)
  server = await new Promise<Server>((resolve) => {
    const s = a.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server?.closeAllConnections()
  server?.close()
})

afterEach(() => vi.restoreAllMocks())

const BAD_IDS = ['no-es-un-id', '123', 'abc%27%20or%201%3D1', '7c9e6679-7425-40de-944b-e07fc1f90ae']

const ROUTES: Array<[string, (id: string) => string]> = [
  ['GET', (id) => `/recipes/${id}`],
  ['GET', (id) => `/recipes/${id}?servings=4`],
  ['PUT', (id) => `/recipes/${id}`],
  ['DELETE', (id) => `/recipes/${id}`],
  ['POST', (id) => `/recipes/${id}/copy`],
  ['POST', (id) => `/recipes/${id}/regenerate-image`],
  ['POST', (id) => `/recipes/${id}/upload-image`],
]

describe('recipe id with a bad shape', () => {
  for (const [method, path] of ROUTES) {
    it(`${method} ${path(':id')} → 404 «Recipe not found», nothing logged`, async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
      for (const id of BAD_IDS) {
        const r = await fetch(base + path(id), {
          method,
          headers: { 'content-type': 'application/json' },
          body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
        })
        expect(r.status, `${method} ${path(id)}`).toBe(404)
        expect(await r.json()).toEqual({ error: 'Recipe not found' })
      }
      expect(errors).not.toHaveBeenCalled()
    })
  }

  it('the static /recipes/... routes are not taken for ids', async () => {
    // No token → their own auth answers, not the id guard.
    for (const path of ['/recipes/match-pantry', '/recipes/with-what-i-have']) {
      expect((await fetch(base + path)).status).toBe(401)
    }
  })

  it('accepts real uuids', () => {
    expect(isRecipeId('7c9e6679-7425-40de-944b-e07fc1f90ae7')).toBe(true)
    expect(isRecipeId('7C9E6679-7425-40DE-944B-E07FC1F90AE7')).toBe(true)
    expect(isRecipeId('no-es-un-id')).toBe(false)
    expect(isRecipeId(undefined)).toBe(false)
  })

  it('every /recipes/:id route in routes/recipes.ts goes through the guard', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'routes', 'recipes.ts'), 'utf8')
    const decls = [...src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*:(?:id|recipeId)[^']*)'([\s\S]{0,120})/g)]
      .filter((m) => m[2].includes('/recipes/:') || m[2].includes(':recipeId'))
    expect(decls.length).toBeGreaterThanOrEqual(7)
    for (const m of decls) {
      expect(m[3], `${m[1].toUpperCase()} ${m[2]}`).toContain('requireRecipeId(')
    }
  })
})
