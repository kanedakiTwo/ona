/**
 * PRO-154 — catalogue import by batches (specs/catalog-import.md).
 * Three invented «pages» go through the whole pipeline with fake AI and
 * database: drafts for 4, the book's sentences never reach what is saved,
 * duplicates are caught, and the publish rule (Miguel's sources vs Cocina's
 * review of every Cocina recipe, D-099). No text from any real book here: every sentence is made up.
 */
import { describe, expect, it } from 'vitest'
import {
  catalogSourceCredit,
  catalogSourceRecord,
  copiedPhrases,
  draftsFromCocinaJson,
  findDuplicate,
  importCatalogBatch,
  markCookingMediumLines,
  listForReview,
  planBatchPublish,
  reviewDecision,
  scaleToHouseServings,
  type BatchRecipe,
  type CatalogDraftInput,
  type CatalogImportDeps,
  type CatalogRewrite,
  type PersistDraftInput,
} from '../services/catalogImport.js'
import { parseRewrite, rewriteMessage } from '../services/catalogRewriter.js'
import { aggregateNutrition, type IngredientCatalogEntry } from '../services/nutrition/aggregate.js'

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

  it('sample lists every draft of the batch (D-099), allergen doubts first', () => {
    const rows = Array.from({ length: 23 }, (_, i) => rec(`c${i}`, { allergenDoubt: i === 5 || i === 17 }))
    rows.push(rec('pub', { status: 'published' }))
    const list = listForReview(rows)
    expect(list).toHaveLength(23)
    expect(list.slice(0, 2)).toEqual(['c5', 'c17'])
    expect(list).not.toContain('pub')
    expect(listForReview([rec('a', { reviewOk: true }), rec('b')])).toEqual(['a', 'b'])
  })

  it("Miguel's sources go out when they pass the audit, without him", () => {
    const plan = planBatchPublish([rec('m1', { origin: 'miguel' }), rec('m2', { origin: 'miguel', auditIssues: ['sin_pasos'] }), rec('m3', { origin: 'miguel', status: 'published' })])
    expect(plan.publish).toEqual(['m1'])
    expect(plan.hold).toEqual([{ id: 'm2', name: 'm2', reason: 'auditoria' }])
  })

  it("Cocina's go out one by one, only with Miguel's OK (PRO-290)", () => {
    expect(planBatchPublish([rec('a'), rec('b')]).hold.map((h) => h.reason)).toEqual(['sin_revisar', 'sin_revisar'])
    // A batch half reviewed: only the OKs go out, the rest wait, a «no» holds only itself.
    const half = planBatchPublish([
      rec('ok1', { sampled: true, reviewOk: true }),
      rec('ok2', { sampled: true, reviewOk: true }),
      rec('seen-no', { sampled: true, reviewOk: false }),
      rec('unseen1', { sampled: true }),
      rec('unseen2'),
      rec('ok-but-audit', { reviewOk: true, auditIssues: ['sin_pasos'] }),
      rec('done', { status: 'published', reviewOk: true }),
    ])
    expect(half.publish).toEqual(['ok1', 'ok2'])
    expect(half.hold).toEqual([
      { id: 'seen-no', name: 'seen-no', reason: 'rechazada' },
      { id: 'unseen1', name: 'unseen1', reason: 'sin_revisar' },
      { id: 'unseen2', name: 'unseen2', reason: 'sin_revisar' },
      { id: 'ok-but-audit', name: 'ok-but-audit', reason: 'auditoria' },
    ])
    // The old rule published the whole batch once the sample was OK: no more.
    expect(planBatchPublish([rec('a', { sampled: true, reviewOk: true }), rec('b')]).publish).toEqual(['a'])
  })

  it('nothing goes out without its photo (Miguel, 2026-10-21): it waits as «sin_foto», after every other reason', () => {
    const plan = planBatchPublish([
      rec('m', { origin: 'miguel', hasPhoto: false }),
      rec('m-photo', { origin: 'miguel', hasPhoto: true }),
      rec('c-ok', { reviewOk: true, hasPhoto: false }),
      rec('c-unseen', { hasPhoto: false }),
      rec('m-audit', { origin: 'miguel', hasPhoto: false, auditIssues: ['sin_pasos'] }),
    ])
    expect(plan.publish).toEqual(['m-photo'])
    expect(plan.hold.map((h) => [h.id, h.reason])).toEqual([
      ['m', 'sin_foto'],
      ['c-ok', 'sin_foto'],
      ['c-unseen', 'sin_revisar'],
      ['m-audit', 'auditoria'],
    ])
    expect(reviewDecision({ origin: 'miguel', auditIssues: [], hasPhoto: false })).toBe('sin_foto')
  })

  it("a mixed batch: Miguel's out on audit, Cocina's only with his OK", () => {
    const plan = planBatchPublish([rec('m', { origin: 'miguel' }), rec('c')])
    expect(plan.publish).toEqual(['m'])
    expect(plan.hold).toEqual([{ id: 'c', name: 'c', reason: 'sin_revisar' }])
  })
})

// ─── PRO-195: frying oil in batch imports ──────────────────────

describe('frying / confit oil in batch imports (PRO-195)', () => {
  it('markCookingMediumLines puts «para freír…» / «para confitar…» first and splits mixed lines', () => {
    const out = markCookingMediumLines([
      { name: 'aceite de oliva', quantity: 500, unit: 'ml', note: 'abundante para freír' },
      { name: 'aceite de oliva virgen extra', quantity: 540, unit: 'ml', note: '40 ml para el sofrito y el resto para freír' },
      { name: 'aceite de girasol para freír', quantity: 1, unit: 'al_gusto' },
      { name: 'Aceite de oliva', quantity: 400, unit: 'ml', note: 'para confitar' },
      { name: 'aceite', quantity: 300, unit: 'ml', note: 'de freír' },
      { name: 'patatas', quantity: 800, unit: 'g', note: 'para freír' },
      { name: 'aceite de oliva', quantity: 2, unit: 'cda', note: 'para el sofrito' },
      { name: 'aceite de oliva', quantity: 3, unit: 'cda', note: '1 cda para el sofrito y el resto para la fritura' },
    ])
    expect(out.map((i) => [i.name, i.quantity, i.unit, i.note ?? null])).toEqual([
      ['aceite de oliva', 500, 'ml', 'para freír; abundante'],
      ['aceite de oliva virgen extra', 40, 'ml', 'para el sofrito'],
      ['aceite de oliva virgen extra', 500, 'ml', 'para freír'],
      ['aceite de girasol', 1, 'al_gusto', 'para freír'],
      ['Aceite de oliva', 400, 'ml', 'para confitar'],
      ['aceite', 300, 'ml', 'para freír'],
      ['patatas', 800, 'g', 'para freír'],
      ['aceite de oliva', 2, 'cda', 'para el sofrito'],
      ['aceite de oliva', 1, 'cda', 'para el sofrito'],
      ['aceite de oliva', 2, 'cda', 'para la fritura'],
    ])
  })

  it('a frying recipe is saved with the note and its nutrition counts 15 % of the oil', async () => {
    const page: CatalogDraftInput = {
      name: 'Berenjenas fritas de prueba',
      servings: 4,
      ingredients: [
        { name: 'berenjena', quantity: 600, unit: 'g' },
        { name: 'aceite de oliva', quantity: 500, unit: 'ml', note: 'abundante para freír' },
      ],
      sourceSteps: ['Cortamos la berenjena en bastones finos y la freímos por tandas en aceite bien caliente.'],
      source: { origin: 'cocina', book: 'Inventado', page: '1' },
    }
    const { deps, saved } = fakeDeps({
      rewrite: async (d) => rewriteFor(d, ['Cortar la berenjena en tiras.', 'Freír en tandas y escurrir.']),
    })
    const [res] = await importCatalogBatch([page], 'prueba-195', deps)
    expect(res.status).toBe('draft')
    const oil = saved[0].ingredients[1]
    expect(oil.note).toBe('para freír; abundante')

    const catalog = new Map<string, IngredientCatalogEntry>([
      ['ing-0', { id: 'ing-0', name: 'berenjena', calories: 25, protein: 1, carbs: 6, fat: 0.2, fiber: 3, salt: 0 }],
      ['ing-1', { id: 'ing-1', name: 'aceite de oliva', calories: 884, protein: 0, carbs: 0, fat: 100, fiber: 0, salt: 0, density: 0.92 }],
    ])
    const agg = aggregateNutrition({
      servings: saved[0].servings,
      ingredients: saved[0].ingredients.map((i, k) => ({ ...i, id: String(k), note: i.note ?? undefined, optional: false, displayOrder: k })) as any,
      catalog,
    })
    // 600 g berenjena = 150 kcal; 500 ml × 0.92 × 15 % = 69 g oil = 610 kcal → 760 / 4
    expect(agg.perServing.kcal).toBe(190)
  })
})

// D-067: the ficha says where a catalogue recipe comes from. Invented names
// and phrases only — never a real book's text.
describe('where the recipe comes from (D-067)', () => {
  const CREDIT = 'Inspirada en una receta de Autora Inventada, «Cuaderno de pruebas»'

  it('catalogSourceCredit: the credit as written; else Miguel\'s book; Cocina\'s and the rest, nothing', () => {
    expect(catalogSourceCredit({ origin: 'miguel', book: 'Cuaderno azul', credit: 'Receta de la tía Prueba' })).toBe('Receta de la tía Prueba')
    expect(catalogSourceCredit({ origin: 'cocina', book: 'Recogidas en la red', credit: `  ${CREDIT}  ` })).toBe(CREDIT)
    expect(catalogSourceCredit({ origin: 'miguel', book: 'Cuaderno azul' })).toBe('Inspirada en Cuaderno azul')
    expect(catalogSourceCredit({ origin: 'miguel', book: 'Cuaderno azul', credit: '   ' })).toBe('Inspirada en Cuaderno azul')
    expect(catalogSourceCredit({ origin: 'miguel', book: 'Cuaderno azul', credit: null })).toBe('Inspirada en Cuaderno azul')
    expect(catalogSourceCredit({ origin: 'cocina', book: 'Recogidas en la red' })).toBeNull()
    expect(catalogSourceCredit({ origin: 'miguel', book: '  ' })).toBeNull()
    expect(catalogSourceCredit({ origin: 'miguel' })).toBeNull()
    expect(catalogSourceCredit({ origin: 'miguel', book: 42, credit: 7 })).toBeNull()
    expect(catalogSourceCredit(null)).toBeNull()
    expect(catalogSourceCredit(undefined)).toBeNull()
  })

  it('draftsFromCocinaJson keeps the credit: the file\'s, the recipe\'s when it has one', () => {
    const drafts = draftsFromCocinaJson(
      {
        source: { origin: 'miguel', book: 'Cuaderno de pruebas', credit: CREDIT },
        recipes: [
          { name: 'Sopa de ajo inventada', ingredients: [{ name: 'ajo', qty: 4, unit: 'u' }], steps: ['Paso inventado.'] },
          { name: 'Tortilla de la tía Prueba', source: { credit: ' Receta de la tía Prueba ', page: 3 }, ingredients: [{ name: 'huevo', qty: 4, unit: 'u' }], steps: ['Paso inventado.'] },
          { name: 'Caldo sin crédito', source: { credit: '' }, ingredients: [{ name: 'agua', qty: 1, unit: 'l' }], steps: ['Paso inventado.'] },
        ],
      },
      { origin: 'cocina', credit: 'Crédito de la línea de comandos' },
    )
    expect(drafts[0].source).toMatchObject({ origin: 'miguel', book: 'Cuaderno de pruebas', credit: CREDIT })
    expect(drafts[1].source).toMatchObject({ origin: 'miguel', book: 'Cuaderno de pruebas', page: '3', credit: 'Receta de la tía Prueba' })
    expect(drafts[2].source.credit).toBeNull()
    // No `source.credit` anywhere in the file → the command's --credit.
    const [plain] = draftsFromCocinaJson([{ name: 'Puré inventado', ingredients: [{ name: 'patata', qty: 500, unit: 'g' }] }], { origin: 'miguel', credit: 'Receta de la Yaya inventada' })
    expect(plain.source.credit).toBe('Receta de la Yaya inventada')
  })

  it('the credit reaches recipes.catalog_source, with the book and page and no text of the source', async () => {
    const { deps, saved } = fakeDeps()
    const page = { ...PAGES[0], source: { ...PAGES[0].source, credit: 'Receta de la tía Prueba' } }
    const [out] = await importCatalogBatch([page], 'tia-01', deps)
    expect(out.status).toBe('draft')
    expect(saved[0].catalogSource).toMatchObject({ origin: 'miguel', book: 'Cuaderno azul', page: '12', credit: 'Receta de la tía Prueba', batch: 'tia-01' })

    // What persistCatalogDraft writes to the column.
    const row = catalogSourceRecord(saved[0].catalogSource)
    expect(row).toEqual({
      origin: 'miguel',
      book: 'Cuaderno azul',
      page: '12',
      file: null,
      credit: 'Receta de la tía Prueba',
      batch: 'tia-01',
      auditIssues: [],
      allergenDoubt: false,
    })
    expect(catalogSourceCredit(row)).toBe('Receta de la tía Prueba')
    // A draft without credit stores null, and Miguel's book stands in.
    const bare = catalogSourceRecord({ ...saved[0].catalogSource, credit: undefined })
    expect(bare.credit).toBeNull()
    expect(catalogSourceCredit(bare)).toBe('Inspirada en Cuaderno azul')
  })
})
