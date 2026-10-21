/**
 * Admin «Recetas pendientes» (specs/catalog-import.md, specs/admin-dashboard.md):
 * the pure side and the background import, without AI nor database.
 *   - `reviewDecision` is the publish rule, recipe by recipe (it is what
 *     `planBatchPublish` applies to a batch: same answers);
 *   - `importCatalogBatch` tells after each recipe how far it is
 *     (`onOutcome`), and a failure there never stops the batch;
 *   - `previewDuplicates`: what an import would skip, before paying for it;
 *   - `buildDraftsView`: drafts grouped by batch, allergen doubts first,
 *     Miguel's «no» apart, the credit line, the audit in words;
 *   - the background runner: progress per recipe, one import at a time,
 *     a crash marks the job «failed», nothing of it in the HTTP request.
 * Invented recipes only.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  importCatalogBatch,
  planBatchPublish,
  previewDuplicates,
  reviewDecision,
  type BatchRecipe,
  type CatalogDraftInput,
  type CatalogImportDeps,
  type ImportOutcome,
} from '../services/catalogImport.js'
import { buildDraftsView, type DraftRow } from '../services/catalogReview.js'
import { ImportBusyError, createCatalogImportRunner, jobView, outcomeView } from '../services/catalogImportJobs.js'
import { createMemoryImportJobStore } from './fixtures/memoryImportJobStore.js'

const rec = (id: string, over: Partial<BatchRecipe> = {}): BatchRecipe => ({ id, name: id, status: 'draft', origin: 'cocina', auditIssues: [], allergenDoubt: false, ...over })

describe('reviewDecision: the publish rule for one recipe', () => {
  it('gives the same answer planBatchPublish gives for the batch', () => {
    const rows = [
      rec('c-new'),
      rec('c-ok', { reviewOk: true }),
      rec('c-no', { reviewOk: false }),
      rec('c-ok-audit', { reviewOk: true, auditIssues: ['sin_pasos'] }),
      rec('m-new', { origin: 'miguel' }),
      rec('m-audit', { origin: 'miguel', auditIssues: ['pocos_ingredientes'] }),
      rec('m-no', { origin: 'miguel', reviewOk: false }),
    ]
    expect(rows.map(reviewDecision)).toEqual(['sin_revisar', 'publicable', 'rechazada', 'auditoria', 'publicable', 'auditoria', 'rechazada'])
    const plan = planBatchPublish(rows)
    expect(plan.publish).toEqual(rows.filter((r) => reviewDecision(r) === 'publicable').map((r) => r.id))
    expect(plan.hold.map((h) => [h.id, h.reason])).toEqual(rows.filter((r) => reviewDecision(r) !== 'publicable').map((r) => [r.id, reviewDecision(r)]))
  })
})

// ─── Progress of a batch ────────────────────────────────────────

function draft(name: string): CatalogDraftInput {
  return {
    name,
    servings: 4,
    ingredients: [
      { name: 'garbanzos cocidos', quantity: 400, unit: 'g' },
      { name: 'cebolla', quantity: 1, unit: 'u' },
      { name: 'sal', quantity: 1, unit: 'al_gusto' },
    ],
    sourceSteps: ['Un paso inventado para la prueba.'],
    source: { origin: 'cocina', book: 'Cuaderno de pruebas' },
  }
}

function fakeDeps(over: Partial<CatalogImportDeps> = {}): CatalogImportDeps {
  let n = 0
  return {
    catalogNames: async () => ['Tortilla de patatas'],
    rewrite: async () => ({
      steps: [{ text: 'Rehogar la cebolla y juntarla con los garbanzos.', ingredientRefs: [0, 1] }],
      meals: ['lunch'],
      seasons: ['winter'],
      course: 'main',
      dishType: 'guiso',
      protein: 'legumbre',
      techniques: [],
      cuisine: 'española',
      activeTime: 10,
      totalTime: 20,
      difficulty: 'easy',
      allergenDoubt: false,
    }),
    matchIngredients: async (_n, ings) => ings.map((i, k) => ({ ingredientId: `ing-${k}`, name: i.name, quantity: i.quantity, unit: i.unit as any })),
    persistDraft: async () => ({ ok: true, recipeId: `r${++n}` }),
    ...over,
  }
}

describe('importCatalogBatch → onOutcome', () => {
  it('reports every recipe as it goes, with how many are done of how many', async () => {
    const seen: Array<[string, string, number, number]> = []
    const out = await importCatalogBatch([draft('Guiso inventado uno'), draft('Tortilla de patata'), draft('Guiso inventado dos')], 'prueba-01', fakeDeps({
      onOutcome: (o, done, total) => {
        seen.push([o.name, o.status, done, total])
      },
    }))
    expect(out.map((o) => o.status)).toEqual(['draft', 'duplicate', 'draft'])
    expect(seen).toEqual([
      ['Guiso inventado uno', 'draft', 1, 3],
      ['Tortilla de patata', 'duplicate', 2, 3],
      ['Guiso inventado dos', 'draft', 3, 3],
    ])
  })

  it('a failure while reporting never stops the batch', async () => {
    const out = await importCatalogBatch([draft('Guiso inventado uno'), draft('Guiso inventado dos')], 'prueba-01', fakeDeps({
      onOutcome: () => {
        throw new Error('sin base de datos')
      },
    }))
    expect(out.map((o) => o.status)).toEqual(['draft', 'draft'])
  })
})

describe('previewDuplicates: what an import would skip, before any AI', () => {
  it('against the catalogue (drafts included) and earlier recipes of the same file', () => {
    expect(previewDuplicates(['Tortilla de patata', 'Guiso inventado', 'guisos inventados', 'Crema nueva'], ['Tortilla de patatas'])).toEqual([
      { name: 'Tortilla de patata', duplicateOf: 'Tortilla de patatas' },
      { name: 'Guiso inventado', duplicateOf: null },
      { name: 'guisos inventados', duplicateOf: 'Guiso inventado' },
      { name: 'Crema nueva', duplicateOf: null },
    ])
  })
})

// ─── The page's view ────────────────────────────────────────────

const row = (id: string, over: Partial<DraftRow> = {}): DraftRow => ({
  id,
  name: `Receta ${id}`,
  importBatch: 'cocina-01',
  catalogSource: { origin: 'cocina', book: 'Cuaderno de pruebas', page: null, batch: 'cocina-01', auditIssues: [], allergenDoubt: false },
  imageUrl: `/images/recipes/${id}.jpg`,
  servings: 4,
  totalTime: 30,
  difficulty: 'easy',
  tips: null,
  tags: ['guiso'],
  createdAt: new Date('2026-10-20T08:00:00Z'),
  ingredients: ['garbanzos', 'cebolla'],
  stepCount: 3,
  ...over,
})

describe('buildDraftsView', () => {
  it('groups by batch (newest first), allergen doubts first, the «no» apart, and counts what would go out', () => {
    const view = buildDraftsView(
      [
        row('a', { createdAt: new Date('2026-10-20T08:00:00Z') }),
        row('b', { createdAt: new Date('2026-10-20T08:01:00Z'), catalogSource: { origin: 'cocina', batch: 'cocina-01', auditIssues: [], allergenDoubt: true, credit: 'Receta de la tía Inventada' } }),
        row('c', { catalogSource: { origin: 'cocina', batch: 'cocina-01', auditIssues: [], allergenDoubt: false, reviewOk: false, reviewedAt: '2026-10-21T09:00:00Z' } }),
        row('d', { catalogSource: { origin: 'cocina', batch: 'cocina-01', auditIssues: ['proteina_fuera_de_rango'], allergenDoubt: false, reviewOk: true } }),
        row('e', { catalogSource: { origin: 'cocina', batch: 'cocina-01', auditIssues: [], allergenDoubt: false, reviewOk: true } }),
        row('m1', { importBatch: 'mama-01', createdAt: new Date('2026-10-21T08:00:00Z'), catalogSource: { origin: 'miguel', book: 'Recetario de mamá', page: '12', batch: 'mama-01', auditIssues: [], allergenDoubt: false } }),
      ],
      { 'cocina-01': 4 },
    )
    expect(view.pending).toBe(5)
    expect(view.batches.map((b) => b.batch)).toEqual(['mama-01', 'cocina-01'])

    const cocina = view.batches[1]
    expect(cocina.origins).toEqual(['cocina'])
    expect(cocina.publishedCount).toBe(4)
    expect(cocina.pending.map((d) => d.id)).toEqual(['b', 'a', 'd', 'e'])
    expect(cocina.discarded.map((d) => d.id)).toEqual(['c'])
    expect(cocina.publishable).toBe(1)
    const byId = Object.fromEntries(cocina.pending.map((d) => [d.id, d]))
    expect(byId.b).toMatchObject({ allergenDoubt: true, credit: 'Receta de la tía Inventada', verdict: null, decision: 'sin_revisar' })
    expect(byId.d.decision).toBe('auditoria')
    expect(byId.d.auditIssues).toEqual([{ code: 'proteina_fuera_de_rango', label: 'proteína principal por ración fuera de 80–300 g' }])
    expect(byId.e).toMatchObject({ verdict: 'ok', decision: 'publicable' })
    expect(cocina.discarded[0]).toMatchObject({ verdict: 'no', decision: 'rechazada', reviewedAt: '2026-10-21T09:00:00Z' })

    const mama = view.batches[0]
    expect(mama.pending[0]).toMatchObject({ origin: 'miguel', book: 'Recetario de mamá', page: '12', credit: 'Inspirada en Recetario de mamá', decision: 'publicable' })
    expect(mama.publishable).toBe(1)
  })

  it('without its photo a draft waits («sin_foto»); «Publicar las aprobadas» still counts it, unless its publish is already waiting', () => {
    const ok = { origin: 'cocina' as const, batch: 'cocina-01', auditIssues: [], allergenDoubt: false, reviewOk: true }
    const view = buildDraftsView(
      [
        row('photo', { catalogSource: ok }),
        row('making', { imageUrl: null, catalogSource: ok }),
        row('queued', { imageUrl: null, catalogSource: { ...ok, publishWhenPhoto: true } }),
        row('unseen', { imageUrl: null }),
      ],
      {},
    )
    const byId = Object.fromEntries(view.batches[0].pending.map((d) => [d.id, d]))
    expect(byId.photo).toMatchObject({ decision: 'publicable', waitingPhoto: false })
    expect(byId.making).toMatchObject({ decision: 'sin_foto', waitingPhoto: false })
    expect(byId.queued).toMatchObject({ decision: 'sin_foto', waitingPhoto: true })
    // Miguel's OK comes first: the photo makes itself, his look doesn't.
    expect(byId.unseen).toMatchObject({ decision: 'sin_revisar' })
    expect(view.batches[0].publishable).toBe(2)
  })

  it('never hands out the source text, only the reference', () => {
    const view = buildDraftsView([row('a', { catalogSource: { origin: 'cocina', batch: 'cocina-01', auditIssues: [], allergenDoubt: false, file: 'tanda.json' } as any })], {})
    const keys = Object.keys(view.batches[0].pending[0])
    expect(keys).not.toContain('catalogSource')
    expect(keys).not.toContain('sourceSteps')
  })
})

// ─── Background import ──────────────────────────────────────────

const outcome = (name: string, status: ImportOutcome['status'], extra: Record<string, unknown> = {}): ImportOutcome =>
  ({ name, source: { origin: 'cocina' }, status, ...(status === 'draft' ? { recipeId: `id-${name}`, auditIssues: [], allergenDoubt: false } : status === 'duplicate' ? { duplicateOf: 'Otra' } : { reason: 'revisor', detail: 'x'.repeat(900) }), ...extra }) as ImportOutcome

describe('the background import', () => {
  it('runs outside the request, saves progress per recipe and ends «done» with its counts', async () => {
    const store = createMemoryImportJobStore()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const runner = createCatalogImportRunner({
      store,
      runImport: async (drafts, _batch, onOutcome) => {
        await onOutcome(outcome(drafts[0].name, 'draft'), 1, 3)
        await gate
        await onOutcome(outcome(drafts[1].name, 'duplicate'), 2, 3)
        await onOutcome(outcome(drafts[2].name, 'rejected'), 3, 3)
      },
    })
    const job = await runner.start({ drafts: [draft('Uno'), draft('Dos'), draft('Tres')], batch: 'prueba-01', origin: 'cocina', fileName: 'tanda.json', adminId: 'admin-1' })
    expect(job.status).toBe('running')
    await vi.waitFor(() => expect(store.rows[0].done).toBe(1))
    expect(jobView(store.rows[0])).toMatchObject({ status: 'running', total: 3, done: 1, counts: { draft: 1, duplicate: 0, rejected: 0 } })

    // One at a time.
    await expect(runner.start({ drafts: [draft('Cuatro')], batch: 'prueba-02', origin: 'cocina', fileName: null, adminId: 'admin-1' })).rejects.toBeInstanceOf(ImportBusyError)

    release()
    await runner.idle()
    const done = jobView(store.rows[0])
    expect(done).toMatchObject({ status: 'done', total: 3, done: 3, counts: { draft: 1, duplicate: 1, rejected: 1 }, batch: 'prueba-01', fileName: 'tanda.json' })
    expect(done.outcomes.map((o) => o.status)).toEqual(['draft', 'duplicate', 'rejected'])
    expect(done.outcomes[2].detail!.length).toBeLessThanOrEqual(500)
    expect(done.finishedAt).not.toBeNull()
    expect(store.rows[0].createdBy).toBe('admin-1')

    // Free again.
    await runner.start({ drafts: [draft('Cinco')], batch: 'prueba-03', origin: 'cocina', fileName: null, adminId: 'admin-1' })
    await runner.idle()
    expect(store.rows).toHaveLength(2)
  })

  it('a crash in the import marks the job «failed» with the reason, and frees the runner', async () => {
    const store = createMemoryImportJobStore()
    const runner = createCatalogImportRunner({
      store,
      runImport: async () => {
        throw new Error('se cayó la conexión')
      },
      log: () => {},
    })
    await runner.start({ drafts: [draft('Uno')], batch: 'prueba-01', origin: 'cocina', fileName: null, adminId: 'admin-1' })
    await runner.idle()
    expect(jobView(store.rows[0])).toMatchObject({ status: 'failed', error: 'se cayó la conexión' })
    await expect(runner.start({ drafts: [draft('Dos')], batch: 'prueba-02', origin: 'cocina', fileName: null, adminId: 'admin-1' })).resolves.toMatchObject({ status: 'running' })
    await runner.idle()
  })

  it('a job still «running» in the database (another process) blocks a new one; the hook before running can veto it', async () => {
    const store = createMemoryImportJobStore()
    await store.create({ batch: 'otra', origin: 'cocina', fileName: null, total: 2, createdBy: 'admin-1' })
    const runImport = vi.fn(async () => {})
    const runner = createCatalogImportRunner({ store, runImport })
    await expect(runner.start({ drafts: [draft('Uno')], batch: 'prueba-01', origin: 'cocina', fileName: null, adminId: 'admin-1' })).rejects.toMatchObject({ batch: 'otra' })
    expect(await store.interruptRunning()).toBe(1)

    await expect(
      runner.start({ drafts: [draft('Uno')], batch: 'prueba-01', origin: 'cocina', fileName: null, adminId: 'admin-1' }, {
        beforeRun: async () => {
          throw new Error('sin auditoría')
        },
      }),
    ).rejects.toThrow('sin auditoría')
    expect(runImport).not.toHaveBeenCalled()
    expect(store.rows.at(-1)).toMatchObject({ status: 'failed' })
    await expect(runner.start({ drafts: [draft('Uno')], batch: 'prueba-01', origin: 'cocina', fileName: null, adminId: 'admin-1' })).resolves.toBeTruthy()
    await runner.idle()
  })

  it('outcomeView keeps the reference and the reason, never the source', () => {
    const v = outcomeView({ ...outcome('Uno', 'draft'), source: { origin: 'cocina', book: 'Libro', file: 'x.json' } } as ImportOutcome)
    expect(v).toEqual({ name: 'Uno', status: 'draft', recipeId: 'id-Uno', allergenDoubt: false, auditIssues: [] })
  })
})
