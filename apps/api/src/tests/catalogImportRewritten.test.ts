/**
 * PRO-1097 (D-150, option C) — a Cocina batch with `reescrita: true` brings
 * the house steps and labels already written (Claude Code in the office, on
 * the subscription), so the import saves it without calling the model: no
 * `catalog_import_rewrite` row in `cost_events`. Without the field, the
 * import calls the rewriter as always. The model is the real
 * `createAnthropicRewriter` over a fake SDK, and the cost rows are the ones
 * `recordCost` would insert (`setCostSinkForTests`). Invented recipes only.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('../db/connection.js', () => ({ db: {} }))

import { catalogImportRequestSchema, checkCocinaBatch } from '@ona/shared'
import { draftsFromCocinaJson, importCatalogBatch, type CatalogImportDeps, type PersistDraftInput } from '../services/catalogImport.js'
import { createAnthropicRewriter } from '../services/catalogRewriter.js'
import { setCostSinkForTests, type CostRow } from '../services/costLedger.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const TEXT = readFileSync(path.join(here, 'fixtures', 'tanda-cocina-inventada.json'), 'utf8')

/** The fixture, rewritten by Cocina: house steps with their links, and the labels. */
function rewrittenBatch() {
  const json = JSON.parse(TEXT)
  json.reescrita = true
  Object.assign(json.recipes[0], {
    steps: [
      { text: 'Pochar la cebolla a fuego suave en una cazuela con un poco de aceite.', durationMin: 10, ingredientRefs: [1] },
      { text: 'Añadir el pimentón, los garbanzos y la sal, y cocer todo junto.', durationMin: 15, technique: 'guisar', ingredientRefs: [2, 0, 3] },
    ],
    course: 'main',
    dishType: 'guiso',
    protein: 'legumbre',
    techniques: ['sofreír', 'guisar'],
    cuisine: 'española',
    activeTime: 15,
    totalTime: 35,
    allergenDoubt: false,
    tips: 'Mejor de un día para otro.',
    freezable: true,
    fridgeDays: 4,
  })
  Object.assign(json.recipes[1], {
    steps: [
      { text: 'Batir los huevos con el azúcar hasta que blanqueen.', ingredientRefs: [1, 2] },
      { text: 'Incorporar la harina y hornear en un molde engrasado.', durationMin: 35, temperature: 180, ingredientRefs: [0] },
    ],
    course: 'dessert',
    dishType: 'bizcocho',
    protein: 'huevo',
    techniques: ['hornear'],
    cuisine: 'española',
    activeTime: 15,
    totalTime: 50,
    allergenDoubt: true,
    allergenNote: 'Gluten y huevo.',
  })
  return json
}

const MODEL_ANSWER = JSON.stringify({
  steps: [{ text: 'Cocinar con calma todos los ingredientes de la lista.', ingredientRefs: [0, 1, 2, 3] }],
  meals: ['lunch'],
  seasons: ['winter'],
  course: 'main',
  dishType: 'guiso',
  protein: 'legumbre',
  techniques: ['guisar'],
  cuisine: 'española',
  activeTime: 10,
  totalTime: 30,
  difficulty: 'easy',
  allergenDoubt: false,
  tips: null,
  freezable: null,
  fridgeDays: null,
})

let costs: CostRow[]

beforeEach(() => {
  costs = []
  setCostSinkForTests(async (row) => void costs.push(row))
  create.mockReset()
  create.mockResolvedValue({ content: [{ type: 'text', text: MODEL_ANSWER }], usage: { input_tokens: 1200, output_tokens: 400 } })
})
afterEach(() => setCostSinkForTests(null))

function deps() {
  const saved: PersistDraftInput[] = []
  const d: CatalogImportDeps = {
    catalogNames: async () => [],
    rewrite: createAnthropicRewriter(),
    matchIngredients: async (_n, ings) => ings.map((i, k) => ({ ingredientId: `ing-${k}`, name: i.name, quantity: i.quantity, unit: i.unit as any, unitWeight: i.unit === 'u' ? 60 : null })),
    persistDraft: async (input) => {
      saved.push(input)
      return { ok: true, recipeId: `r${saved.length}` }
    },
  }
  return { deps: d, saved }
}

/** What the route reads: the page's payload through the route's schema. */
function throughRoute(file: unknown) {
  const parsed = catalogImportRequestSchema.safeParse(JSON.parse(JSON.stringify({ batch: 'cocina-20', fileName: 'tanda.json', file })))
  expect(parsed.success).toBe(true)
  if (!parsed.success) throw parsed.error
  return draftsFromCocinaJson(parsed.data.file, { origin: 'cocina', book: null, credit: null, file: 'tanda.json' })
}

const rewriteCosts = () => costs.filter((c) => c.feature === 'catalog_import_rewrite')

describe('a batch with reescrita: true (PRO-1097)', () => {
  it('is saved with its own steps and labels, with no call to the model and no catalog_import_rewrite cost', async () => {
    const { deps: d, saved } = deps()
    const out = await importCatalogBatch(throughRoute(rewrittenBatch()), 'cocina-20', d)
    expect(out.map((o) => o.status)).toEqual(['draft', 'draft'])
    expect(create).not.toHaveBeenCalled()
    expect(rewriteCosts()).toEqual([])

    const [guiso, bizcocho] = saved
    expect(guiso.steps).toEqual([
      { index: 0, text: 'Pochar la cebolla a fuego suave en una cazuela con un poco de aceite.', durationMin: 10, temperature: null, technique: null, ingredientRefs: ['ing_1'] },
      { index: 1, text: 'Añadir el pimentón, los garbanzos y la sal, y cocer todo junto.', durationMin: 15, temperature: null, technique: 'guisar', ingredientRefs: ['ing_2', 'ing_0', 'ing_3'] },
    ])
    // The labels go the same way as the rewriter's.
    expect(guiso).toMatchObject({ course: 'main', difficulty: 'easy', prepTime: 15, cookTime: 20, tips: 'Mejor de un día para otro.', freezable: true, fridgeDays: 4, meals: ['lunch', 'dinner'], seasons: ['autumn', 'winter'] })
    expect(guiso.tags).toEqual(expect.arrayContaining(['cuchara', 'guiso', 'española']))
    expect(guiso.internalTags).toEqual(expect.arrayContaining(['catalogo-tanda', 'tipo:guiso', 'proteina:legumbre', 'tecnica:sofreir', 'tecnica:guisar', 'cocina:espanola']))
    // For 4: 8 servings → half; the allergen doubt travels with the draft.
    expect(bizcocho.ingredients[0].quantity).toBe(125)
    expect(bizcocho).toMatchObject({ course: 'dessert', difficulty: 'medium', prepTime: 15, cookTime: 35 })
    expect(bizcocho.steps[1]).toMatchObject({ durationMin: 35, temperature: 180 })
    expect(bizcocho.internalTags).toContain('alergenos:duda')
    expect(bizcocho.catalogSource).toMatchObject({ origin: 'cocina', batch: 'cocina-20', allergenDoubt: true, credit: 'Receta del primo Ficticio' })
    expect(out[1]).toMatchObject({ status: 'draft', allergenDoubt: true })
  })

  it('still goes through the duplicate check and the audit', async () => {
    const { deps: d, saved } = deps()
    d.catalogNames = async () => ['Guiso de pruebas con garbanzo']
    const json = rewrittenBatch()
    json.recipes[1].ingredients = json.recipes[1].ingredients.slice(0, 2)
    json.recipes[1].steps = [{ text: 'Batir los huevos con la harina y hornear.', ingredientRefs: [0, 1] }]
    const out = await importCatalogBatch(throughRoute(json), 'cocina-20', d)
    expect(out[0]).toMatchObject({ status: 'duplicate', duplicateOf: 'Guiso de pruebas con garbanzo' })
    expect(out[1].status).toBe('draft')
    expect(out[1].status === 'draft' && out[1].auditIssues.length).toBeGreaterThan(0)
    expect(saved).toHaveLength(1)
    expect(create).not.toHaveBeenCalled()
  })

  it('a bad label is told in Spanish, like any other field', () => {
    const json = rewrittenBatch()
    json.recipes[0].course = 'segundo'
    json.recipes[1].steps[0].ingredientRefs = ['huevo']
    const r = checkCocinaBatch(json)
    expect(r.ok).toBe(false)
    const problems = r.ok ? [] : r.problems
    expect(problems.some((p) => p.startsWith('Receta 1 («Guiso de prueba con garbanzos»): el tipo de plato del menú (course) «segundo» no vale'))).toBe(true)
    expect(problems.some((p) => p.startsWith('Receta 2 («Bizcocho de prueba de los lunes»), paso 1, ingredientRefs'))).toBe(true)
  })

  it('the check says the batch comes rewritten', () => {
    const r = checkCocinaBatch(rewrittenBatch())
    expect(r.ok && r.warnings.some((w) => w.includes('«reescrita»: true'))).toBe(true)
  })
})

describe('a batch without reescrita', () => {
  it('calls the rewriter for every recipe, as always (catalog_import_rewrite on Mimoia)', async () => {
    const { deps: d, saved } = deps()
    const json = rewrittenBatch()
    delete json.reescrita
    const out = await importCatalogBatch(throughRoute(json), 'cocina-20', d)
    expect(out.map((o) => o.status)).toEqual(['draft', 'draft'])
    expect(create).toHaveBeenCalledTimes(2)
    expect(rewriteCosts()).toHaveLength(2)
    expect(rewriteCosts().every((c) => c.userId === null)).toBe(true)
    // What is saved is the model's, not the labels in the file.
    expect(saved[0].steps.map((s) => s.text)).toEqual(['Cocinar con calma todos los ingredientes de la lista.'])
    expect(saved[1].course).toBe('main')
  })
})
