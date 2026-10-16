/**
 * PRO-154 — catalogue import by batches (specs/catalog-import.md).
 * Three invented «pages» go through the whole pipeline with fake AI and
 * database: drafts for 4, the book's sentences never reach what is saved,
 * duplicates are caught, and the publish rule (Miguel's sources vs Cocina's
 * one-in-ten sample). No text from any real book here: every sentence is made up.
 */
import { describe, expect, it } from 'vitest'
import {
  copiedPhrases,
  draftsFromCocinaJson,
  findDuplicate,
  importCatalogBatch,
  pickReviewSample,
  planBatchPublish,
  scaleToHouseServings,
  type BatchRecipe,
  type CatalogDraftInput,
  type CatalogImportDeps,
  type CatalogRewrite,
  type PersistDraftInput,
} from '../services/catalogImport.js'
import { parseRewrite, rewriteMessage } from '../services/catalogRewriter.js'

// Three made-up pages of a made-up book.
const PAGES: CatalogDraftInput[] = [
  {
    name: 'Guiso de garbanzos del abuelo Tomás',
    servings: 6,
    ingredients: [
      { name: 'garbanzos cocidos', quantity: 600, unit: 'g' },
      { name: 'cebolla', quantity: 150, unit: 'g' },
      { name: 'pimentón dulce', quantity: 1, unit: 'cdita' },
      { name: 'sal', quantity: 1, unit: 'al_gusto' },
    ],
    sourceSteps: [
      'Pochamos la cebolla muy despacito en una olla ancha con un buen chorro de aceite hasta que quede dorada.',
      'Echamos el pimentón fuera del fuego, removemos rápido y añadimos los garbanzos con su caldito de la víspera.',
    ],
    source: { origin: 'miguel', book: 'Cuaderno azul', page: '12' },
  },
  {
    name: 'Merluza en salsa verde de la tía Rosa',
    servings: 2,
    ingredients: [
      { name: 'merluza', quantity: 300, unit: 'g' },
      { name: 'perejil', quantity: 10, unit: 'g' },
      { name: 'ajo', quantity: 1, unit: 'u' },
    ],
    sourceSteps: ['Doramos el ajo laminado sin que llegue a quemarse y metemos los lomos con la piel hacia arriba en la cazuela de barro.'],
    source: { origin: 'miguel', book: 'Cuaderno azul', page: '13' },
  },
  {
    name: 'Bizcocho de yogur de los domingos',
    servings: 8,
    ingredients: [
      { name: 'yogur natural', quantity: 250, unit: 'g' },
      { name: 'harina de trigo', quantity: 300, unit: 'g' },
      { name: 'huevo', quantity: 3, unit: 'u' },
    ],
    sourceSteps: ['Batimos los huevos con el yogur hasta que la mezcla blanquee y luego vamos incorporando la harina tamizada poco a poco.'],
    source: { origin: 'miguel', book: 'Cuaderno azul', page: '14' },
  },
]

function rewriteFor(draft: CatalogDraftInput, steps: string[]): CatalogRewrite {
  return {
    steps: steps.map((text, i) => ({ text, durationMin: 10, ingredientRefs: [i % draft.ingredients.length] })),
    meals: ['lunch', 'dinner'],
    seasons: ['autumn', 'winter'],
    course: 'main',
    dishType: 'guiso',
    protein: 'legumbre',
    techniques: ['sofreír'],
    cuisine: 'española',
    activeTime: 20,
    totalTime: 40,
    difficulty: 'easy',
    allergenDoubt: false,
  }
}

/** House rewrite: own words. The first try for the merluza copies one sentence from the book. */
const HOUSE_STEPS: Record<string, string[]> = {
  'Guiso de garbanzos del abuelo Tomás': ['Calentar aceite en una cazuela y cocinar la cebolla picada a fuego suave.', 'Retirar del fuego, añadir el pimentón y después los garbanzos con su líquido.'],
  'Merluza en salsa verde de la tía Rosa': ['Saltear el ajo en láminas a fuego medio.', 'Colocar la merluza en la cazuela, espolvorear el perejil y dejar que se haga.'],
  'Bizcocho de yogur de los domingos': ['Mezclar los huevos y el yogur con varillas.', 'Añadir la harina tamizada en tres veces y hornear.'],
}

function fakeDeps(over: Partial<CatalogImportDeps> = {}) {
  const saved: PersistDraftInput[] = []
  const rewrites: Array<{ name: string; avoid?: string[] }> = []
  const deps: CatalogImportDeps = {
    catalogNames: async () => ['Lentejas con chorizo', 'Tortilla de patatas'],
    rewrite: async (d, opts) => {
      rewrites.push({ name: d.name, avoid: opts.avoidPhrases })
      if (d.name.startsWith('Merluza') && !opts.avoidPhrases) {
        return rewriteFor(d, ['Doramos el ajo laminado sin que llegue a quemarse y metemos los lomos.', 'Terminar con el perejil.'])
      }
      return rewriteFor(d, HOUSE_STEPS[d.name])
    },
    matchIngredients: async (_n, ings) => ings.map((i, k) => ({ ingredientId: `ing-${k}`, name: i.name, quantity: i.quantity, unit: i.unit as any, unitWeight: i.unit === 'u' ? 60 : null })),
    persistDraft: async (input) => {
      saved.push(input)
      return { ok: true, recipeId: `r${saved.length}` }
    },
    ...over,
  }
  return { deps, saved, rewrites }
}

describe('import of three pages (PRO-154)', () => {
  it('saves three drafts for 4, with book and page and no sentence of the book', async () => {
    const { deps, saved, rewrites } = fakeDeps()
    const out = await importCatalogBatch(PAGES, 'cuaderno-01', deps)
    expect(out.map((o) => o.status)).toEqual(['draft', 'draft', 'draft'])
    expect(saved).toHaveLength(3)
    for (const [i, s] of saved.entries()) {
      expect(s.servings).toBe(4)
      expect(s.catalogSource).toMatchObject({ origin: 'miguel', book: 'Cuaderno azul', page: PAGES[i].source.page, batch: 'cuaderno-01' })
      // What is saved never carries the book's sentences.
      const written = s.steps.map((x) => x.text)
      expect(copiedPhrases(PAGES[i].sourceSteps, written)).toEqual([])
      for (const sentence of PAGES[i].sourceSteps) expect(written).not.toContain(sentence)
      expect(JSON.stringify(s)).not.toContain(PAGES[i].sourceSteps[0].slice(0, 40))
    }
    // 600 g for 6 → 400 g for 4; 300 g for 2 → 600 g; 3 eggs for 8 → 1.5.
    expect(saved[0].ingredients[0].quantity).toBe(400)
    expect(saved[0].ingredients[3]).toMatchObject({ unit: 'al_gusto', quantity: 1 })
    expect(saved[1].ingredients[0].quantity).toBe(600)
    expect(saved[2].ingredients[2].quantity).toBe(1.5)
    // The merluza was rewritten again because its first try copied the book.
    expect(rewrites.filter((r) => r.name.startsWith('Merluza'))).toHaveLength(2)
    expect(rewrites.find((r) => r.avoid)?.avoid?.[0]).toContain('doramos el ajo laminado')
    // Labels: public tags + hidden ones; times → prep 20 + cook 20.
    expect(saved[0].tags).toEqual(expect.arrayContaining(['guiso', 'española']))
    expect(saved[0].internalTags).toEqual(expect.arrayContaining(['catalogo-tanda', 'proteina:legumbre', 'tecnica:sofreir', 'cocina:espanola', 'tipo:guiso']))
    expect(saved[0]).toMatchObject({ prepTime: 20, cookTime: 20, course: 'main', difficulty: 'easy' })
    expect(saved[0].steps[0].ingredientRefs).toEqual(['ing_0'])
  })

  it('a rewrite that keeps copying the book is rejected and never saved', async () => {
    const { deps, saved } = fakeDeps({
      rewrite: async (d) => rewriteFor(d, ['Batimos los huevos con el yogur hasta que la mezcla blanquee y ya está.']),
    })
    const [out] = await importCatalogBatch([PAGES[2]], 't', deps)
    expect(out).toMatchObject({ status: 'rejected', reason: 'copia_del_libro' })
    expect(saved).toHaveLength(0)
  })

  it('unmatched ingredients and reviewer errors reject the recipe; one failure never stops the batch', async () => {
    const { deps } = fakeDeps({
      matchIngredients: async (n, ings) => ings.map((i, k) => ({ ingredientId: n.startsWith('Guiso') && k === 0 ? null : `x${k}`, name: i.name, quantity: i.quantity, unit: i.unit as any })),
      persistDraft: async (input) => (input.name.startsWith('Merluza') ? { ok: false, errors: ['El ingrediente "perejil" no se menciona en ningún paso.'] } : { ok: true, recipeId: 'ok' }),
    })
    const out = await importCatalogBatch(PAGES, 't', deps)
    expect(out[0]).toMatchObject({ status: 'rejected', reason: 'ingredientes' })
    expect(out[1]).toMatchObject({ status: 'rejected', reason: 'revisor' })
    expect(out[2].status).toBe('draft')
  })

  it('the audit result travels with the draft (it decides publishing later)', async () => {
    const { deps, saved } = fakeDeps()
    // 1 merluza line of 600 g for 4 = 150 g/serving → fine; make it 2 ingredients → «pocos ingredientes».
    const thin = { ...PAGES[1], ingredients: PAGES[1].ingredients.slice(0, 2) }
    const [out] = await importCatalogBatch([thin], 't', deps)
    expect(out).toMatchObject({ status: 'draft', auditIssues: ['pocos_ingredientes'] })
    expect(saved[0].catalogSource.auditIssues).toEqual(['pocos_ingredientes'])
  })
})

describe('duplicates', () => {
  it('finds the same dish whatever the accents, plurals, order or a typo', () => {
    const catalog = ['Tortilla de patatas', 'Lentejas con chorizo', 'Crema de calabaza']
    expect(findDuplicate('Tortilla de patata', catalog)).toBe('Tortilla de patatas')
    expect(findDuplicate('lentejas CON chorizo', catalog)).toBe('Lentejas con chorizo')
    expect(findDuplicate('Crema de calabaza asada', catalog)).toBeNull()
    expect(findDuplicate('Crema de calabasa', catalog)).toBe('Crema de calabaza')
    expect(findDuplicate('Pastel de carne', catalog)).toBeNull()
  })

  it('skips a recipe already in the catalogue and a repeat within the batch', async () => {
    const { deps, saved } = fakeDeps()
    const out = await importCatalogBatch(
      [
        { ...PAGES[0], name: 'Tortilla de patata' },
        PAGES[2],
        { ...PAGES[2], source: { ...PAGES[2].source, page: '99' } },
      ],
      't',
      deps,
    )
    expect(out.map((o) => o.status)).toEqual(['duplicate', 'draft', 'duplicate'])
    expect(out[0]).toMatchObject({ duplicateOf: 'Tortilla de patatas' })
    expect(saved).toHaveLength(1)
  })
})

describe('pure helpers', () => {
  it('copiedPhrases sees 7 words in a row, not shared single words', () => {
    const src = ['Cortamos la cebolla en juliana fina y la dejamos sudar tapada.']
    expect(copiedPhrases(src, ['Picar la cebolla y dejarla sudar con la tapa puesta.'])).toEqual([])
    expect(copiedPhrases(src, ['Primero, cortamos la cebolla en juliana fina y la reservamos.']).length).toBeGreaterThan(0)
  })

  it('scales to 4 and leaves «al gusto» alone', () => {
    const out = scaleToHouseServings([{ name: 'arroz', quantity: 150, unit: 'g' }, { name: 'sal', quantity: 1, unit: 'al_gusto' }, { name: 'huevo', quantity: 1, unit: 'u' }], 2)
    expect(out.map((i) => i.quantity)).toEqual([300, 1, 2])
  })

  it('reads Cocina JSON with the file source as fallback', () => {
    const drafts = draftsFromCocinaJson(
      { source: { origin: 'cocina', book: 'Recogidas en la red' }, recipes: [{ name: 'Sopa de ajo', servings: 4, ingredients: [{ name: 'ajo', qty: 4, unit: 'u' }], steps: [{ text: 'Paso inventado.' }] }] },
      { origin: 'miguel' },
    )
    expect(drafts[0]).toMatchObject({ name: 'Sopa de ajo', source: { origin: 'cocina', book: 'Recogidas en la red' }, sourceSteps: ['Paso inventado.'] })
    expect(drafts[0].ingredients[0]).toMatchObject({ name: 'ajo', quantity: 4, unit: 'u' })
  })

  it('the rewrite prompt carries the source steps but asks not to copy them; the parser tolerates fences', () => {
    const msg = rewriteMessage(PAGES[0], ['frase repetida del original'])
    expect(msg).toContain('no los copies')
    expect(msg).toContain('«frase repetida del original»')
    const r = parseRewrite('```json\n{"steps":[{"text":"Picar.","ingredientRefs":[0,"x"]}],"allergenDoubt":true}\n```')
    expect(r.steps).toEqual([{ text: 'Picar.', durationMin: null, temperature: null, technique: null, ingredientRefs: [0] }])
    expect(r.allergenDoubt).toBe(true)
  })
})

describe('publishing (rule of Miguel, 2026-10-16)', () => {
  const rec = (id: string, over: Partial<BatchRecipe> = {}): BatchRecipe => ({ id, name: id, status: 'draft', origin: 'cocina', auditIssues: [], allergenDoubt: false, ...over })

  it('the sample is one in ten (rounded up) plus every allergen doubt', () => {
    const rows = Array.from({ length: 23 }, (_, i) => rec(`c${i}`, { allergenDoubt: i === 5 || i === 17 }))
    let seed = 1
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const sample = pickReviewSample(rows, random)
    expect(sample).toEqual(expect.arrayContaining(['c5', 'c17']))
    expect(sample.length).toBeGreaterThanOrEqual(3)
    expect(sample.length).toBeLessThanOrEqual(5)
    expect(pickReviewSample([rec('a')])).toEqual(['a'])
  })

  it("Miguel's sources go out when they pass the audit, without him", () => {
    const plan = planBatchPublish([rec('m1', { origin: 'miguel' }), rec('m2', { origin: 'miguel', auditIssues: ['sin_pasos'] }), rec('m3', { origin: 'miguel', status: 'published' })])
    expect(plan.publish).toEqual(['m1'])
    expect(plan.hold).toEqual([{ id: 'm2', name: 'm2', reason: 'auditoria' }])
  })

  it("Cocina's wait for the sample, then for Miguel's verdict; a «no» holds the batch", () => {
    expect(planBatchPublish([rec('a'), rec('b')]).hold.map((h) => h.reason)).toEqual(['falta_muestra', 'falta_muestra'])
    expect(planBatchPublish([rec('a', { sampled: true }), rec('b')]).publish).toEqual([])
    expect(planBatchPublish([rec('a', { sampled: true }), rec('b')]).hold[0].reason).toBe('muestra_sin_revisar')
    expect(planBatchPublish([rec('a', { sampled: true, reviewOk: true }), rec('b')]).publish).toEqual(['a', 'b'])
    const no = planBatchPublish([rec('a', { sampled: true, reviewOk: false }), rec('b')])
    expect(no.publish).toEqual([])
    expect(no.hold).toEqual([{ id: 'a', name: 'a', reason: 'rechazada' }, { id: 'b', name: 'b', reason: 'muestra_con_rechazos' }])
  })
})
