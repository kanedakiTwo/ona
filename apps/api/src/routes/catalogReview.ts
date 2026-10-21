/**
 * Admin «Recetas pendientes» (specs/catalog-import.md, specs/admin-dashboard.md).
 * Every route: admin JWT (`authMiddleware` + `requireAdmin`); the metrics read
 * token opens none of them. Every change lands in `admin_audit_log`.
 *
 *   GET  /admin/catalog-drafts                  catalogue drafts by batch (what `sample`/`status` show)
 *   POST /admin/catalog-drafts/:id/publish      Miguel's OK + this recipe out (409 if the audit holds it;
 *                                               `waitingPhoto: true` when it goes out once its photo is made)
 *   POST /admin/catalog-drafts/:id/discard      Miguel's «no»: it never goes out
 *   POST /admin/catalog-drafts/:id/restore      the verdict taken back
 *   POST /admin/catalog-batches/:batch/publish  what the rule allows in the batch (`publish --batch=…`)
 *   POST /admin/catalog-import/check            { batch, fileName?, file } → the file checked + what it would skip
 *   POST /admin/catalog-import/jobs             same body → 202: import as drafts in the background
 *   GET  /admin/catalog-import/jobs[?limit=]    latest imports with their progress
 *   GET  /admin/catalog-import/jobs/:id
 *
 * Mounted before the global `express.json()` (100 KB): a batch file can be
 * bigger, so the import routes read their own body, up to 2 MB.
 */
import express, { Router, type ErrorRequestHandler, type RequestHandler, type Response } from 'express'
import { z } from 'zod'
import { CATALOG_BATCH_ID_RE, catalogImportRequestSchema, checkCocinaBatch, type CatalogDraftsView, type CatalogImportRequest } from '@ona/shared'
import { env } from '../config/env.js'
import { authMiddleware, requireAdmin, type AuthRequest } from '../middleware/auth.js'
import { record } from '../services/auditLog.js'
import { draftsFromCocinaJson, importCatalogBatch } from '../services/catalogImport.js'
import { createDbCatalogImportDeps } from '../services/catalogImportDb.js'
import {
  ImportBusyError,
  createCatalogImportRunner,
  createDbImportJobStore,
  jobView,
  type CatalogImportRunner,
  type ImportJobRow,
} from '../services/catalogImportJobs.js'
import {
  discardCatalogDraft,
  loadCatalogDrafts,
  previewImport,
  publishApprovedInBatch,
  publishCatalogDraft,
  restoreCatalogDraft,
  type BatchPublishResult,
  type DraftActionResult,
} from '../services/catalogReview.js'
import { createAnthropicRewriter } from '../services/catalogRewriter.js'
import { wakeCatalogPhotos } from '../services/catalogPhotos.js'

export interface CatalogReviewDeps {
  adminAuth: RequestHandler[]
  loadDrafts: () => Promise<CatalogDraftsView>
  publishDraft: (id: string, adminId: string) => Promise<DraftActionResult>
  discardDraft: (id: string, adminId: string) => Promise<DraftActionResult>
  restoreDraft: (id: string, adminId: string) => Promise<DraftActionResult>
  publishBatch: (batch: string, adminId: string) => Promise<BatchPublishResult>
  previewImport: (names: string[], batch: string) => Promise<{ recipes: Array<{ name: string; duplicateOf: string | null }>; alreadyInBatch: number }>
  /** The import needs the house rewrite (Anthropic). */
  canImport: () => boolean
  startImport: CatalogImportRunner['start']
  listJobs: (limit: number) => Promise<ImportJobRow[]>
  getJob: (id: string) => Promise<ImportJobRow | null>
  record: typeof record
}

const jobStore = createDbImportJobStore()
let runner: CatalogImportRunner | null = null

/** One runner per API process: one import at a time. */
function defaultRunner(): CatalogImportRunner {
  runner ??= createCatalogImportRunner({
    store: jobStore,
    runImport: async (drafts, batch, onOutcome) => {
      const log = (line: string) => console.log(`[catalog-import ${batch}] ${line}`)
      const deps = createDbCatalogImportDeps(createAnthropicRewriter(), log)
      return importCatalogBatch(drafts, batch, {
        ...deps,
        onOutcome: async (outcome, done, total) => {
          await onOutcome(outcome, done, total)
          // Its photo starts now, so it's there by the time Miguel publishes.
          if (outcome.status === 'draft') wakeCatalogPhotos()
        },
      })
    },
  })
  return runner
}

const uuid = z.string().uuid()
/** Existing batch ids (the command's `--batch=` was free text); no slashes. */
const BATCH_PARAM = /^[A-Za-z0-9][\w.-]{0,99}$/
const BODY_LIMIT = '2mb'

const NOT_FOUND = { error: 'Ese borrador ya no está pendiente (¿publicado o borrado?).', code: 'NOT_FOUND' }

/** The body checked with the shared schema; the problems in Spanish when it fails. */
function readImportBody(body: unknown): { ok: true; data: CatalogImportRequest } | { ok: false; problems: string[] } {
  const parsed = catalogImportRequestSchema.safeParse(body)
  if (parsed.success) return { ok: true, data: parsed.data }
  const b = (body ?? {}) as { batch?: unknown; file?: unknown; fileName?: unknown }
  const problems: string[] = []
  if (typeof b.batch !== 'string' || !CATALOG_BATCH_ID_RE.test(b.batch)) {
    problems.push('El nombre de la tanda: solo minúsculas, números y guiones, hasta 60 (por ejemplo, cocina-02).')
  }
  const file = checkCocinaBatch(b.file)
  if (!file.ok) problems.push(...file.problems)
  if (b.fileName != null && (typeof b.fileName !== 'string' || b.fileName.length > 200)) problems.push('El nombre del fichero no es válido.')
  return { ok: false, problems: problems.length ? problems : ['La petición no tiene el formato esperado.'] }
}

function badBody(res: Response, problems: string[]): void {
  res.status(400).json({ error: problems[0], code: 'INVALID_BATCH_FILE', problems })
}

const bodyErrors: ErrorRequestHandler = (err, _req, res, next) => {
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'El fichero es demasiado grande para una tanda (máximo 2 MB). Pártelo en dos.', code: 'TOO_LARGE' })
    return
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'No es un JSON válido.', code: 'INVALID_JSON', problems: ['No es un JSON válido.'] })
    return
  }
  next(err)
}

function fail(res: Response, where: string, err: unknown): void {
  console.error(`[admin/catalog] ${where} failed:`, (err as Error)?.message ?? err)
  res.status(500).json({ error: 'Internal server error' })
}

export function createCatalogReviewRouter(overrides: Partial<CatalogReviewDeps> = {}): Router {
  const d: CatalogReviewDeps = {
    adminAuth: [authMiddleware as RequestHandler, requireAdmin as RequestHandler],
    loadDrafts: () => loadCatalogDrafts(),
    publishDraft: (id, adminId) => publishCatalogDraft(id, adminId),
    discardDraft: (id, adminId) => discardCatalogDraft(id, adminId),
    restoreDraft: (id, adminId) => restoreCatalogDraft(id, adminId),
    publishBatch: (batch, adminId) => publishApprovedInBatch(batch, adminId),
    previewImport: (names, batch) => previewImport(names, batch),
    canImport: () => !!env.ANTHROPIC_API_KEY,
    startImport: (input, opts) => defaultRunner().start(input, opts),
    listJobs: (limit) => jobStore.list(limit),
    getJob: (id) => jobStore.get(id),
    record,
    ...overrides,
  }
  const router = Router()
  const parseBody = express.json({ limit: BODY_LIMIT })

  router.get('/admin/catalog-drafts', ...d.adminAuth, async (_req, res) => {
    try {
      res.json(await d.loadDrafts())
    } catch (err) {
      fail(res, 'drafts', err)
    }
  })

  router.post('/admin/catalog-drafts/:id/publish', ...d.adminAuth, async (req: AuthRequest, res) => {
    if (!uuid.safeParse(req.params.id).success) return void res.status(404).json(NOT_FOUND)
    try {
      const r = await d.publishDraft(String(req.params.id), req.userId!)
      if (r.ok) return void res.json({ published: !r.waitingPhoto, waitingPhoto: !!r.waitingPhoto, id: r.id, name: r.name, batch: r.batch, wishesCovered: r.wishesCovered ?? 0 })
      if (r.code === 'AUDIT_HOLD') {
        const what = r.issues.map((i) => `«${i.label}»`).join(', ')
        return void res.status(409).json({
          error: `No sale: la auditoría ve ${what}. Corrige la receta (o descártala); la regla no publica nada con avisos de la auditoría.`,
          code: 'AUDIT_HOLD',
          issues: r.issues,
        })
      }
      res.status(404).json(NOT_FOUND)
    } catch (err) {
      fail(res, 'publish draft', err)
    }
  })

  router.post('/admin/catalog-drafts/:id/discard', ...d.adminAuth, async (req: AuthRequest, res) => {
    if (!uuid.safeParse(req.params.id).success) return void res.status(404).json(NOT_FOUND)
    try {
      const r = await d.discardDraft(String(req.params.id), req.userId!)
      if (!r.ok) return void res.status(404).json(NOT_FOUND)
      res.json({ discarded: true, id: r.id, name: r.name, batch: r.batch })
    } catch (err) {
      fail(res, 'discard draft', err)
    }
  })

  router.post('/admin/catalog-drafts/:id/restore', ...d.adminAuth, async (req: AuthRequest, res) => {
    if (!uuid.safeParse(req.params.id).success) return void res.status(404).json(NOT_FOUND)
    try {
      const r = await d.restoreDraft(String(req.params.id), req.userId!)
      if (!r.ok) return void res.status(404).json(NOT_FOUND)
      res.json({ restored: true, id: r.id, name: r.name, batch: r.batch })
    } catch (err) {
      fail(res, 'restore draft', err)
    }
  })

  router.post('/admin/catalog-batches/:batch/publish', ...d.adminAuth, async (req: AuthRequest, res) => {
    const batch = String(req.params.batch)
    if (!BATCH_PARAM.test(batch)) return void res.status(400).json({ error: 'Esa tanda no tiene un nombre válido.', code: 'INVALID_BATCH' })
    try {
      res.json(await d.publishBatch(batch, req.userId!))
    } catch (err) {
      fail(res, 'publish batch', err)
    }
  })

  router.post('/admin/catalog-import/check', ...d.adminAuth, parseBody, async (req: AuthRequest, res) => {
    const body = readImportBody(req.body)
    if (!body.ok) return badBody(res, body.problems)
    const check = checkCocinaBatch(body.data.file)
    if (!check.ok) return badBody(res, check.problems)
    try {
      const preview = await d.previewImport(check.names, body.data.batch)
      res.json({ batch: body.data.batch, origin: check.origin, book: check.book, recipes: preview.recipes, warnings: check.warnings, alreadyInBatch: preview.alreadyInBatch })
    } catch (err) {
      fail(res, 'import check', err)
    }
  })

  router.post('/admin/catalog-import/jobs', ...d.adminAuth, parseBody, async (req: AuthRequest, res) => {
    if (!d.canImport()) {
      return void res.status(503).json({ error: 'Para importar hace falta la clave de Anthropic en el servidor (ANTHROPIC_API_KEY).', code: 'NO_AI_KEY' })
    }
    const body = readImportBody(req.body)
    if (!body.ok) return badBody(res, body.problems)
    const { batch, fileName = null, file } = body.data
    const origin = file.source?.origin ?? 'cocina'
    // Same reading as `import --json=… --origin=cocina`: the file's (or the recipe's) source wins.
    const drafts = draftsFromCocinaJson(file, { origin: 'cocina', book: null, credit: null, file: fileName ?? null })
    const adminId = req.userId!
    try {
      const job = await d.startImport(
        { drafts, batch, origin, fileName: fileName ?? null, adminId },
        {
          beforeRun: async (j) => {
            await d.record({ adminId, action: 'catalog_import.start', targetType: 'catalog_import', targetId: j.id, payload: { batch, origin, fileName: fileName ?? null, recipes: drafts.length } })
          },
        },
      )
      res.status(202).json({ job: jobView(job) })
    } catch (err) {
      if (err instanceof ImportBusyError) return void res.status(409).json({ error: err.message, code: 'IMPORT_RUNNING', batch: err.batch })
      fail(res, 'import start', err)
    }
  })

  router.get('/admin/catalog-import/jobs', ...d.adminAuth, async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 20)
    try {
      res.json({ jobs: (await d.listJobs(limit)).map(jobView) })
    } catch (err) {
      fail(res, 'import jobs', err)
    }
  })

  router.get('/admin/catalog-import/jobs/:id', ...d.adminAuth, async (req, res) => {
    if (!uuid.safeParse(req.params.id).success) return void res.status(404).json({ error: 'Esa importación no existe.', code: 'NOT_FOUND' })
    try {
      const job = await d.getJob(String(req.params.id))
      if (!job) return void res.status(404).json({ error: 'Esa importación no existe.', code: 'NOT_FOUND' })
      res.json({ job: jobView(job) })
    } catch (err) {
      fail(res, 'import job', err)
    }
  })

  router.use('/admin/catalog-import', bodyErrors)
  return router
}

export default createCatalogReviewRouter()
