/**
 * PRO-1097 (D-150, option C) — a Cocina batch with `reescrita: true` brings
 * the house steps and labels already written (Claude Code in the office, on
 * the subscription), so the import saves it without calling the model: no
 * `catalog_import_rewrite` row in `cost_events`. Since PRO-1312 (D-164) a
 * batch without the field is refused, ingredients match without the AI and
 * nothing in the import asks the model. The model is the real
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

import { NOT_REWRITTEN, catalogImportRequestSchema, checkCocinaBatch } from '@ona/shared'
import { draftsFromCocinaJson, importCatalogBatch, noHouseRewrite, type CatalogImportDeps, type PersistDraftInput } from '../services/catalogImport.js'
import { matchDraftIngredientsFromCatalog } from '../services/catalogImportDb.js'
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

})

describe('PRO-1312 (D-164): the import makes no call to the model', () => {
  it('ingredients match from the catalogue (`catalogo` or name), never with the AI; an unmatched line is left out and held by the audit', async () => {
    const { deps: d, saved } = deps()
    d.matchIngredients = async () => {
      throw new Error('the AI matcher must not be asked')
    }
    const asked: string[][] = []
    d.matchFromCatalog = async (ings) => {
      asked.push(ings.map((i) => i.catalogRef ?? i.name))
      return ings.map((i, k) => ({ ingredientId: i.name === 'pimentón dulce' ? null : `ing-${k}`, name: i.name, quantity: i.quantity, unit: i.unit as any }))
    }
    const json = rewrittenBatch()
    json.recipes[0].ingredients[0].catalogo = 'Garbanzo cocido'
    json.recipes[0].photoDescription = 'Cazuela de barro con garbanzos en salsa roja de pimentón.'
    const out = await importCatalogBatch(throughRoute(json), 'cocina-21', d)
    expect(out.map((o) => o.status)).toEqual(['draft', 'draft'])
    expect(create).not.toHaveBeenCalled()
    expect(costs).toEqual([])
    expect(asked[0]).toEqual(['Garbanzo cocido', 'cebolla', 'pimentón dulce', 'sal'])

    const [guiso, bizcocho] = saved
    // «pimentón dulce» (line 3) is left out; the steps' links follow the lines that stay.
    expect(guiso.ingredients.map((i) => i.ingredientId)).toEqual(['ing-0', 'ing-1', 'ing-3'])
    expect(guiso.steps[1].ingredientRefs).toEqual(['ing_0', 'ing_2'])
    expect(guiso.catalogSource).toMatchObject({ unmatchedIngredients: ['pimentón dulce'], photoDescription: 'Cazuela de barro con garbanzos en salsa roja de pimentón.' })
    expect(guiso.catalogSource.auditIssues).toContain('ingrediente_sin_emparejar')
    expect(out[0]).toMatchObject({ status: 'draft', auditIssues: expect.arrayContaining(['ingrediente_sin_emparejar']) })
    expect(bizcocho.catalogSource.auditIssues).not.toContain('ingrediente_sin_emparejar')
    expect(bizcocho.catalogSource.unmatchedIngredients).toBeUndefined()
  })

  it('the catalogue match: `catalogo` by id or exact name (accents and case aside), else the line\'s name, else the token match; nothing is created', async () => {
    const catalog = [
      { id: 'g1', name: 'Garbanzo cocido', unitWeight: null, density: null, edibleFraction: null },
      { id: 'c1', name: 'Cebolla', unitWeight: 150, density: null, edibleFraction: 0.9 },
      { id: 'p1', name: 'Pimentón', unitWeight: null, density: null, edibleFraction: null },
    ]
    const fakeDb = { select: () => ({ from: async () => catalog }) } as any
    const line = (name: string, catalogRef?: string) => ({ name, quantity: 1, unit: 'u', ...(catalogRef ? { catalogRef } : {}) })
    const out = await matchDraftIngredientsFromCatalog(
      [line('garbanzos', 'garbanzo  COCIDO'), line('cebolla tierna', 'c1'), line('CEBOLLA'), line('pimentón'), line('trufa negra'), line('pimentón', 'Pimentón de la Vera')],
      fakeDb,
    )
    expect(out.map((m) => m.ingredientId)).toEqual(['g1', 'c1', 'c1', 'p1', null, null])
    expect(out[1]).toMatchObject({ name: 'Cebolla', unitWeight: 150, edibleFraction: 0.9, unit: 'u' })
    expect(out[4].name).toBe('trufa negra')
  })

  it('a batch without «reescrita»: true is refused before anything is imported, in words', () => {
    const json = rewrittenBatch()
    delete json.reescrita
    const r = checkCocinaBatch(json)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems).toEqual([NOT_REWRITTEN])
    expect(catalogImportRequestSchema.safeParse({ batch: 'cocina-20', fileName: 'tanda.json', file: json }).success).toBe(false)
  })

  it('a draft that still asks for the rewrite fails in words and pays nothing (noHouseRewrite, what the command and the page pass)', async () => {
    const { deps: d, saved } = deps()
    d.rewrite = noHouseRewrite
    const json = rewrittenBatch()
    delete json.reescrita
    const out = await importCatalogBatch(draftsFromCocinaJson(json, { origin: 'cocina' }), 'cocina-20', d)
    expect(out).toEqual([
      expect.objectContaining({ status: 'rejected', reason: 'error', detail: NOT_REWRITTEN }),
      expect.objectContaining({ status: 'rejected', reason: 'error', detail: NOT_REWRITTEN }),
    ])
    expect(saved).toEqual([])
    expect(create).not.toHaveBeenCalled()
    expect(costs).toEqual([])
  })
})
