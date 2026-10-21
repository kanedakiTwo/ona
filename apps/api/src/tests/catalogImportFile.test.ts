/**
 * Cocina's batch file from the admin page (specs/catalog-import.md →
 * «Recetas pendientes»). The page checks the file with the shared schema
 * before sending it, and POST /admin/catalog-import/jobs checks it again with
 * the same one — this file pins both ends:
 *   - a well-formed file passes, with its origin, names and warnings;
 *   - every mistake is told in Spanish, pointing at the recipe and line;
 *   - contract: what the page sends (`buildCatalogImportPayload`) is exactly
 *     what the route's schema accepts, and what the importer
 *     (`draftsFromCocinaJson`) reads from it is the same as from the raw file.
 * The fixture is invented: no text from any real batch or book.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CATALOG_IMPORT_MAX_RECIPES,
  buildCatalogImportPayload,
  catalogImportRequestSchema,
  checkCocinaBatch,
  checkCocinaBatchText,
  suggestCatalogBatchId,
} from '@ona/shared'
import { draftsFromCocinaJson } from '../services/catalogImport.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const TEXT = readFileSync(path.join(here, 'fixtures', 'tanda-cocina-inventada.json'), 'utf8')
const RAW = JSON.parse(TEXT)
const clone = () => JSON.parse(TEXT)

function problemsOf(json: unknown): string[] {
  const r = checkCocinaBatch(json)
  expect(r.ok).toBe(false)
  return r.ok ? [] : r.problems
}

describe('checkCocinaBatch: a good file', () => {
  it('passes, with its origin, book, names and no warnings', () => {
    const r = checkCocinaBatchText(TEXT)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.origin).toBe('cocina')
    expect(r.book).toBe('Cuaderno de pruebas')
    expect(r.names).toEqual(['Guiso de prueba con garbanzos', 'Bizcocho de prueba de los lunes'])
    expect(r.warnings).toEqual([])
  })

  it('a bare list of recipes is a file too (origin Cocina by default)', () => {
    const r = checkCocinaBatch(RAW.recipes)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.origin).toBe('cocina')
  })

  it('warns, without failing, when a dish is twice in the file or the file is from Miguel\'s sources', () => {
    const json = clone()
    json.recipes.push({ ...json.recipes[0], name: 'guiso de prueba con  garbanzos' })
    json.source.origin = 'miguel'
    const r = checkCocinaBatch(json)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.warnings.some((w) => w.includes('dos veces') && w.includes('Guiso de prueba con garbanzos'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('tus fuentes') && w.includes('sin pasar por tu revisión'))).toBe(true)
  })
})

describe('checkCocinaBatch: mistakes, told in Spanish', () => {
  it('not JSON: says where to look', () => {
    const r = checkCocinaBatchText('{\n  "recipes": [\n    { "name": "Algo" \n  ]\n}')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toMatch(/^No es un JSON válido/)
    expect(r.problems[0]).toMatch(/línea \d+/)
  })

  it('empty text and the wrong shape', () => {
    const empty = checkCocinaBatchText('   ')
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.problems[0]).toMatch(/Pega el JSON/)
    expect(problemsOf('hola')[0]).toMatch(/lista de recetas/)
    expect(problemsOf({ recetas: [] })[0]).toMatch(/«recipes»/)
    expect(problemsOf({ recipes: [] })[0]).toMatch(/ninguna receta/)
  })

  it('points at the recipe and the ingredient by position and name', () => {
    const json = clone()
    json.recipes[1].ingredients[1].unit = 'gr'
    delete json.recipes[0].ingredients[0].qty
    json.recipes[0].ingredients[2].qty = 0
    json.recipes[1].meals = ['comida']
    const problems = problemsOf(json)
    expect(problems).toContain('Receta 2 («Bizcocho de prueba de los lunes»), ingrediente 2 («huevo»): la unidad «gr» no vale; usa g, ml, u, cda, cdita, pizca o al_gusto.')
    expect(problems).toContain('Receta 1 («Guiso de prueba con garbanzos»), ingrediente 1 («garbanzos cocidos»): falta la cantidad (qty).')
    expect(problems).toContain('Receta 1 («Guiso de prueba con garbanzos»), ingrediente 3 («pimentón dulce»): la cantidad (qty) tiene que ser mayor que 0.')
    expect(problems).toContain('Receta 2 («Bizcocho de prueba de los lunes»), meals: «comida» no vale; usa breakfast, lunch, dinner o snack.')
  })

  it('a recipe with no name, no ingredients or no steps', () => {
    const json = clone()
    json.recipes[0].name = '  '
    json.recipes[1].ingredients = []
    json.recipes[1].steps = []
    const problems = problemsOf(json)
    expect(problems).toContain('Receta 1: el nombre está vacío.')
    expect(problems).toContain('Receta 2 («Bizcocho de prueba de los lunes»): no tiene ingredientes.')
    expect(problems).toContain('Receta 2 («Bizcocho de prueba de los lunes»): no tiene pasos.')
  })

  it('wrong types: a number as text, a step that is not text', () => {
    const json = clone()
    json.recipes[0].servings = '4'
    json.recipes[0].steps[0] = 7
    const problems = problemsOf(json)
    expect(problems).toContain('Receta 1 («Guiso de prueba con garbanzos»): las raciones (servings) tienen que ser un número.')
    expect(problems).toContain('Receta 1 («Guiso de prueba con garbanzos»), paso 1: tiene que ser un texto.')
  })

  it('too many recipes for one batch, and the list of problems is capped', () => {
    const many = Array.from({ length: CATALOG_IMPORT_MAX_RECIPES + 1 }, (_, i) => ({ ...RAW.recipes[0], name: `Plato ${i}` }))
    expect(problemsOf(many)[0]).toMatch(`máximo por tanda es ${CATALOG_IMPORT_MAX_RECIPES}`)
    const broken = Array.from({ length: 40 }, () => ({ name: 'Sin nada', ingredients: [], steps: [] }))
    const problems = problemsOf(broken)
    expect(problems.length).toBeLessThanOrEqual(26)
    expect(problems.at(-1)).toMatch(/y \d+ problemas más/)
  })
})

describe('suggestCatalogBatchId', () => {
  it('takes the file name without the date in front', () => {
    expect(suggestCatalogBatchId('2026-10-20-cocina-01.json')).toBe('cocina-01')
    expect(suggestCatalogBatchId('Tanda Cocina 3 (otoño).JSON')).toBe('tanda-cocina-3-otono')
    expect(suggestCatalogBatchId(null)).toBe('')
  })
})

describe('contract: what the page sends is what the route and the importer read', () => {
  it('buildCatalogImportPayload → catalogImportRequestSchema → draftsFromCocinaJson', () => {
    const built = buildCatalogImportPayload({ text: TEXT, fileName: '2026-10-21-cocina-02.json', batch: ' Cocina-02 ' })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.payload.batch).toBe('cocina-02')
    // Over the wire as JSON, like the browser does.
    const parsed = catalogImportRequestSchema.safeParse(JSON.parse(JSON.stringify(built.payload)))
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const fallback = { origin: 'cocina' as const, book: null, credit: null, file: parsed.data.fileName ?? null }
    const fromPayload = draftsFromCocinaJson(parsed.data.file, fallback)
    const fromRaw = draftsFromCocinaJson(RAW, fallback)
    expect(fromPayload).toEqual(fromRaw)
    expect(fromPayload[1].source.credit).toBe('Receta del primo Ficticio')
    expect(fromPayload[0].sourceSteps).toHaveLength(2)
  })

  it('a bad batch name or a bad file never builds a payload', () => {
    const badBatch = buildCatalogImportPayload({ text: TEXT, fileName: null, batch: 'tanda con espacios!' })
    expect(badBatch.ok).toBe(false)
    if (!badBatch.ok) expect(badBatch.problems[0]).toMatch(/nombre de la tanda/)
    const badFile = buildCatalogImportPayload({ text: '[]', fileName: null, batch: 'cocina-02' })
    expect(badFile.ok).toBe(false)
    // Both at once: the batch name and what is wrong in the file.
    const both = buildCatalogImportPayload({ text: '[]', fileName: null, batch: '' })
    expect(both.ok).toBe(false)
    if (!both.ok) expect(both.problems).toEqual(['Ponle nombre a la tanda (por ejemplo, cocina-02).', 'El fichero no trae ninguna receta.'])
  })

  it('the route schema refuses what the page would never send', () => {
    expect(catalogImportRequestSchema.safeParse({ batch: 'cocina-02', file: { recipes: [] } }).success).toBe(false)
    expect(catalogImportRequestSchema.safeParse({ batch: '../x', file: RAW }).success).toBe(false)
    expect(catalogImportRequestSchema.safeParse({ batch: 'cocina-02', file: RAW }).success).toBe(true)
  })
})
