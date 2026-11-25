/**
 * Smoke (real Postgres) for PRO-1312 (D-164, specs/catalog-import.md): a
 * rewritten Cocina batch is imported without a single call to the model.
 *   - the ingredients match from the catalogue — `catalogo` by id or exact
 *     name, else the line's own name — never with the AI, and a line that
 *     matches nothing is left out and held by the audit («ingrediente sin
 *     emparejar»);
 *   - the batch's `photoDescription` is kept, and the house photo uses it
 *     instead of asking «describir»;
 *   - nothing is billed: the cost sink stays empty and the SDK is never called
 *     (with a key set, so a call would happen if anything asked).
 * Invented recipe only.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/catalogImportSinApi.smoke.ts
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create }
  },
}))
vi.mock('../config/env.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../config/env.js')>()
  return { env: { ...real.env, ANTHROPIC_API_KEY: 'test-key' } }
})

import { inArray } from 'drizzle-orm'
import { catalogImportRequestSchema } from '@ona/shared'
import { reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { ingredients, recipeIngredients, recipes } from '../db/schema.js'
import { draftsFromCocinaJson, importCatalogBatch, noHouseRewrite } from '../services/catalogImport.js'
import { createDbCatalogImportDeps } from '../services/catalogImportDb.js'
import { setCostSinkForTests, type CostRow } from '../services/costLedger.js'
import { loadDish, makeHouseImage } from '../services/recipeHouseImage.js'

const tag = `sinapi${Date.now().toString(36)}`
const DESCRIPTION = 'Cazuela de barro con garbanzos guisados, tomate y cebolla pochada, vista desde arriba.'
const created: string[] = []
let costs: CostRow[] = []

beforeEach(() => {
  costs = []
  setCostSinkForTests(async (row) => void costs.push(row))
  create.mockReset()
  create.mockRejectedValue(new Error('the model must not be called'))
})
afterEach(() => setCostSinkForTests(null))
afterAll(async () => {
  if (!reachable || !created.length) return
  await db.delete(recipes).where(inArray(recipes.id, created))
})

async function catalogIngredient(name: string): Promise<{ id: string; name: string }> {
  const [row] = await db.select({ id: ingredients.id, name: ingredients.name }).from(ingredients).where(inArray(ingredients.name, [name]))
  if (!row) throw new Error(`the seed has no «${name}»`)
  return row
}

describe.skipIf(!reachable)('a rewritten batch, imported without the API (PRO-1312)', () => {
  it('matches from the catalogue, keeps the photo description and makes no call to the model', async () => {
    const garbanzos = await catalogIngredient('garbanzos')
    const cebolla = await catalogIngredient('cebolla')
    const tomate = await catalogIngredient('tomate')
    const file = {
      reescrita: true,
      source: { origin: 'cocina', credit: 'Receta de la tía Inventada' },
      recipes: [
        {
          name: `Garbanzos de prueba ${tag}`,
          servings: 4,
          difficulty: 'easy',
          meals: ['lunch', 'dinner'],
          seasons: ['autumn', 'winter'],
          ingredients: [
            { name: 'garbanzos cocidos', qty: 500, unit: 'g', catalogo: garbanzos.id },
            { name: 'cebolla tierna', qty: 1, unit: 'u', catalogo: 'CEBOLLA' },
            { name: tomate.name, qty: 200, unit: 'g' },
            { name: 'polvo de estrellas inventado', qty: 1, unit: 'pizca' },
          ],
          steps: [
            { text: 'Pochar la cebolla a fuego suave hasta que esté blanda.', durationMin: 10, ingredientRefs: [1] },
            { text: 'Añadir el tomate y los garbanzos y cocer a fuego lento.', durationMin: 15, ingredientRefs: [2, 0] },
          ],
          course: 'main',
          dishType: 'guiso',
          protein: 'legumbre',
          techniques: ['guisar'],
          cuisine: 'española',
          activeTime: 15,
          totalTime: 30,
          allergenDoubt: false,
          photoDescription: DESCRIPTION,
        },
      ],
    }
    const parsed = catalogImportRequestSchema.safeParse({ batch: tag, fileName: 'tanda.json', file })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const drafts = draftsFromCocinaJson(parsed.data.file, { origin: 'cocina', file: 'tanda.json' })
    const out = await importCatalogBatch(drafts, tag, createDbCatalogImportDeps(noHouseRewrite))
    expect(out).toEqual([expect.objectContaining({ status: 'draft', auditIssues: expect.arrayContaining(['ingrediente_sin_emparejar']) })])
    const id = out[0].status === 'draft' ? out[0].recipeId : ''
    created.push(id)

    const lines = await db.select({ ingredientId: recipeIngredients.ingredientId }).from(recipeIngredients).where(inArray(recipeIngredients.recipeId, [id]))
    expect(lines.map((l) => l.ingredientId).sort()).toEqual([garbanzos.id, cebolla.id, tomate.id].sort())
    const [row] = await db.select({ status: recipes.status, catalogSource: recipes.catalogSource }).from(recipes).where(inArray(recipes.id, [id]))
    expect(row.status).toBe('draft')
    expect(row.catalogSource).toMatchObject({ unmatchedIngredients: ['polvo de estrellas inventado'], photoDescription: DESCRIPTION })

    // The photo reads the batch's description: «describir» is never asked.
    const dish = await loadDish(id)
    expect(dish?.description).toBe(DESCRIPTION)
    const describe = vi.fn(async () => 'no')
    const generate = vi.fn(async () => Buffer.from('png'))
    const made = await makeHouseImage(dish!, { describe, generate, check: async () => null })
    expect(describe).not.toHaveBeenCalled()
    expect(made.description).toBe(DESCRIPTION)
    expect(generate.mock.calls[0][0]).toContain(DESCRIPTION)

    expect(create).not.toHaveBeenCalled()
    expect(costs).toEqual([])
  })
})
