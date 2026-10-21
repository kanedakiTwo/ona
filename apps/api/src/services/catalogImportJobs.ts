/**
 * Background import of a Cocina batch file from the admin page «Recetas
 * pendientes» (specs/catalog-import.md). Importing calls the AI for every
 * recipe (minutes for a batch), so the HTTP request only starts it: the
 * import runs in this API process, one at a time, and leaves its progress in
 * `catalog_import_jobs` (how many are done, what happened to each). The
 * recipes it saves are drafts, like the command's: they appear in the page's
 * list as they arrive, and nothing is published.
 *
 * A job still `running` when the API boots died with the old process (a
 * deploy): `interruptStaleCatalogImports` marks it `interrupted`. Uploading
 * the same file again is safe — the recipes already in are skipped as repeated.
 */
import { desc, eq, sql } from 'drizzle-orm'
import type { CatalogImportJobStatus, CatalogImportJobView, CatalogImportOutcomeView, CatalogOriginName } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { catalogImportJobs } from '../db/schema.js'
import type { CatalogDraftInput, ImportOutcome } from './catalogImport.js'
import { runWithCostUser } from './costLedger.js'

type Db = typeof defaultDb

export interface ImportJobRow {
  id: string
  batch: string
  origin: CatalogOriginName
  fileName: string | null
  status: CatalogImportJobStatus
  total: number
  done: number
  outcomes: CatalogImportOutcomeView[]
  error: string | null
  createdBy: string | null
  createdAt: Date
  finishedAt: Date | null
}

export interface ImportJobStore {
  create(input: { batch: string; origin: CatalogOriginName; fileName: string | null; total: number; createdBy: string | null }): Promise<ImportJobRow>
  /** One more recipe done (`done` = how many so far). */
  progress(id: string, done: number, outcome: CatalogImportOutcomeView): Promise<void>
  finish(id: string, status: 'done' | 'failed', error?: string | null): Promise<void>
  findRunning(): Promise<ImportJobRow | null>
  list(limit: number): Promise<ImportJobRow[]>
  get(id: string): Promise<ImportJobRow | null>
  /** Boot: jobs left `running` by a process that is gone → `interrupted`. */
  interruptRunning(): Promise<number>
}

const DETAIL_MAX = 500
export const INTERRUPTED_ERROR = 'El servidor se reinició a mitad de la importación. Sube el mismo fichero otra vez: las que ya entraron se saltan como repetidas.'

/** Pure: what is kept of one recipe's result — the reference and the reason, never the source. */
export function outcomeView(o: ImportOutcome): CatalogImportOutcomeView {
  if (o.status === 'draft') return { name: o.name, status: 'draft', recipeId: o.recipeId, allergenDoubt: o.allergenDoubt, auditIssues: [...o.auditIssues] }
  if (o.status === 'duplicate') return { name: o.name, status: 'duplicate', duplicateOf: o.duplicateOf }
  return { name: o.name, status: 'rejected', reason: o.reason, ...(o.detail ? { detail: o.detail.slice(0, DETAIL_MAX) } : {}) }
}

/** Pure: a job as the page shows it. */
export function jobView(row: ImportJobRow): CatalogImportJobView {
  const counts = { draft: 0, duplicate: 0, rejected: 0 }
  for (const o of row.outcomes) counts[o.status] += 1
  return {
    id: row.id,
    batch: row.batch,
    origin: row.origin,
    fileName: row.fileName,
    status: row.status,
    total: row.total,
    done: row.done,
    counts,
    outcomes: row.outcomes,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  }
}

export class ImportBusyError extends Error {
  constructor(public readonly batch: string) {
    super(`Ya hay una importación en curso (tanda ${batch}). Espera a que acabe.`)
    this.name = 'ImportBusyError'
  }
}

export interface StartImportInput {
  drafts: CatalogDraftInput[]
  batch: string
  origin: CatalogOriginName
  fileName: string | null
  adminId: string
}

export type RunImport = (
  drafts: CatalogDraftInput[],
  batch: string,
  onOutcome: (outcome: ImportOutcome, done: number, total: number) => Promise<void>,
) => Promise<unknown>

export interface CatalogImportRunner {
  /**
   * Create the job and start it in the background; resolves as soon as it is
   * running. `beforeRun` (the audit log) runs first: if it throws, the job is
   * marked failed and never runs. Throws `ImportBusyError` while another runs.
   */
  start(input: StartImportInput, opts?: { beforeRun?: (job: ImportJobRow) => Promise<void> }): Promise<ImportJobRow>
  /** Resolves when the current import (if any) has ended. */
  idle(): Promise<void>
}

export function createCatalogImportRunner(deps: { store: ImportJobStore; runImport: RunImport; log?: (line: string) => void }): CatalogImportRunner {
  const log = deps.log ?? ((line: string) => console.log(line))
  let busyBatch: string | null = null
  let current: Promise<void> = Promise.resolve()

  return {
    async start(input, opts = {}) {
      if (busyBatch) throw new ImportBusyError(busyBatch)
      busyBatch = input.batch
      let job: ImportJobRow | null = null
      try {
        const running = await deps.store.findRunning()
        if (running) throw new ImportBusyError(running.batch)
        job = await deps.store.create({ batch: input.batch, origin: input.origin, fileName: input.fileName, total: input.drafts.length, createdBy: input.adminId })
        if (opts.beforeRun) await opts.beforeRun(job)
      } catch (err) {
        if (job) await deps.store.finish(job.id, 'failed', (err as Error)?.message ?? String(err)).catch(() => {})
        busyBatch = null
        throw err
      }
      const id = job.id
      // A system job, like the command: the AI it pays for is Mimoia's, not
      // the cost of the admin who clicked (the request's cost context).
      current = runWithCostUser(null, async () => {
        try {
          await deps.runImport(input.drafts, input.batch, async (outcome, done) => {
            await deps.store.progress(id, done, outcomeView(outcome))
          })
          await deps.store.finish(id, 'done')
        } catch (err) {
          const message = (err as Error)?.message ?? String(err)
          log(`[catalog-import] ${input.batch}: failed: ${message}`)
          await deps.store.finish(id, 'failed', message).catch((e) => log(`[catalog-import] ${input.batch}: could not mark failed: ${(e as Error)?.message ?? e}`))
        } finally {
          busyBatch = null
        }
      })
      return job
    },
    idle: () => current,
  }
}

// ─── Postgres store ─────────────────────────────────────────────

type JobRecord = typeof catalogImportJobs.$inferSelect

function toRow(r: JobRecord): ImportJobRow {
  return {
    id: r.id,
    batch: r.batch,
    origin: r.origin === 'miguel' ? 'miguel' : 'cocina',
    fileName: r.fileName,
    status: r.status as CatalogImportJobStatus,
    total: r.total,
    done: r.done,
    outcomes: (r.outcomes ?? []) as CatalogImportOutcomeView[],
    error: r.error,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
  }
}

export function createDbImportJobStore(db: Db = defaultDb): ImportJobStore {
  return {
    async create(input) {
      const [row] = await db
        .insert(catalogImportJobs)
        .values({ batch: input.batch, origin: input.origin, fileName: input.fileName, total: input.total, createdBy: input.createdBy, status: 'running' })
        .returning()
      return toRow(row)
    },
    async progress(id, done, outcome) {
      await db
        .update(catalogImportJobs)
        .set({ done, outcomes: sql`${catalogImportJobs.outcomes} || ${JSON.stringify([outcome])}::jsonb` })
        .where(eq(catalogImportJobs.id, id))
    },
    async finish(id, status, error = null) {
      await db.update(catalogImportJobs).set({ status, error, finishedAt: new Date() }).where(eq(catalogImportJobs.id, id))
    },
    async findRunning() {
      const [row] = await db.select().from(catalogImportJobs).where(eq(catalogImportJobs.status, 'running')).orderBy(desc(catalogImportJobs.createdAt)).limit(1)
      return row ? toRow(row) : null
    },
    async list(limit) {
      const rows = await db.select().from(catalogImportJobs).orderBy(desc(catalogImportJobs.createdAt)).limit(limit)
      return rows.map(toRow)
    },
    async get(id) {
      const [row] = await db.select().from(catalogImportJobs).where(eq(catalogImportJobs.id, id)).limit(1)
      return row ? toRow(row) : null
    },
    async interruptRunning() {
      const rows = await db
        .update(catalogImportJobs)
        .set({ status: 'interrupted', error: INTERRUPTED_ERROR, finishedAt: new Date() })
        .where(eq(catalogImportJobs.status, 'running'))
        .returning({ id: catalogImportJobs.id })
      return rows.length
    },
  }
}

/** Boot (index.ts): a job left `running` died with the previous process. Best effort, never blocks the boot. */
export async function interruptStaleCatalogImports(store: ImportJobStore = createDbImportJobStore()): Promise<void> {
  try {
    const n = await store.interruptRunning()
    if (n > 0) console.log(`[catalog-import] ${n} importación(es) interrumpida(s) por el reinicio`)
  } catch (err) {
    console.error('[catalog-import] could not mark interrupted imports:', (err as Error)?.message ?? err)
  }
}
