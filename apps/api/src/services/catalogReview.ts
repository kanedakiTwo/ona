/**
 * Admin «Recetas pendientes» (specs/catalog-import.md, specs/admin-dashboard.md):
 * the catalogue drafts grouped by batch, and Miguel's verdict recipe by
 * recipe — what the command does with `sample`, `review` and `publish`, from
 * the web. Same rule (D-099, PRO-290): a Cocina recipe goes out only with his
 * OK; an audit issue holds any recipe; nothing is published without a click.
 *
 * Every action runs in one transaction with its `admin_audit_log` row
 * (specs/admin-audit-log.md): if the audit can't be written, nothing changes.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { CatalogDraftBatchView, CatalogDraftView, CatalogDraftsView, CatalogOriginName } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { ingredients, recipeIngredients, recipeSteps, recipes, type CatalogSourceInfo } from '../db/schema.js'
import { record } from './auditLog.js'
import { AUDIT_ISSUE_LABEL, type CatalogAuditIssue } from './catalogRecipeAudit.js'
import { catalogSourceCredit, previewDuplicates, reviewDecision, type HoldReason } from './catalogImport.js'
import { allCatalogNames, publishBatch } from './catalogImportDb.js'
import { wakeCatalogPhotos } from './catalogPhotos.js'
import { markWishesCovered } from './catalogWishes.js'
import { DRAFT, PUBLISHED } from './recipeVisibility.js'

type Db = typeof defaultDb
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** A draft as loaded for the page (no source text: there is none to load). */
export interface DraftRow {
  id: string
  name: string
  importBatch: string | null
  catalogSource: Partial<CatalogSourceInfo> | null
  imageUrl: string | null
  servings: number
  totalTime: number | null
  difficulty: string | null
  tips: string | null
  tags: string[] | null
  createdAt: Date | null
  ingredients: string[]
  stepCount: number
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

function originOf(s: Partial<CatalogSourceInfo> | null | undefined): CatalogOriginName {
  return s?.origin === 'miguel' ? 'miguel' : 'cocina'
}

function auditOf(s: Partial<CatalogSourceInfo> | null | undefined): string[] {
  return Array.isArray(s?.auditIssues) ? s!.auditIssues.map(String) : []
}

export function auditLabels(issues: readonly string[]): Array<{ code: string; label: string }> {
  return issues.map((code) => ({ code, label: AUDIT_ISSUE_LABEL[code as CatalogAuditIssue] ?? code }))
}

/** Pure: one draft as the page shows it. */
export function draftView(r: DraftRow): CatalogDraftView {
  const s = r.catalogSource ?? {}
  const origin = originOf(s)
  const auditIssues = auditOf(s)
  const reviewOk = typeof s.reviewOk === 'boolean' ? s.reviewOk : undefined
  return {
    id: r.id,
    name: r.name,
    batch: r.importBatch ?? text(s.batch) ?? 'sin-tanda',
    origin,
    book: text(s.book),
    page: s.page != null && String(s.page).trim() ? String(s.page).trim() : null,
    file: text(s.file),
    credit: catalogSourceCredit(s),
    imageUrl: r.imageUrl,
    servings: r.servings,
    totalTime: r.totalTime,
    difficulty: r.difficulty,
    ingredients: r.ingredients,
    stepCount: r.stepCount,
    tips: r.tips,
    tags: r.tags ?? [],
    allergenDoubt: !!s.allergenDoubt,
    auditIssues: auditLabels(auditIssues),
    verdict: reviewOk === true ? 'ok' : reviewOk === false ? 'no' : null,
    reviewedAt: text(s.reviewedAt),
    decision: reviewDecision({ origin, auditIssues, reviewOk, hasPhoto: !!r.imageUrl }),
    waitingPhoto: !r.imageUrl && !!s.publishWhenPhoto,
    createdAt: r.createdAt ? r.createdAt.toISOString() : null,
  }
}

/**
 * Pure: drafts grouped by batch, the newest batch first. In a batch, the
 * ones still to decide (allergen doubts first, then in import order) and,
 * apart, the ones Miguel turned down.
 */
export function buildDraftsView(rows: readonly DraftRow[], publishedByBatch: Readonly<Record<string, number>>): CatalogDraftsView {
  const byBatch = new Map<string, CatalogDraftView[]>()
  for (const v of rows.map(draftView)) {
    const list = byBatch.get(v.batch) ?? []
    list.push(v)
    byBatch.set(v.batch, list)
  }
  const batches: CatalogDraftBatchView[] = [...byBatch].map(([batch, views]) => {
    const ordered = [...views].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
    const live = ordered.filter((v) => v.verdict !== 'no')
    const pending = [...live.filter((v) => v.allergenDoubt), ...live.filter((v) => !v.allergenDoubt)]
    return {
      batch,
      origins: [...new Set(ordered.map((v) => v.origin))],
      pending,
      discarded: ordered.filter((v) => v.verdict === 'no'),
      publishedCount: publishedByBatch[batch] ?? 0,
      // What «Publicar las aprobadas» would send: out now, or once its photo is made.
      publishable: pending.filter((v) => v.decision === 'publicable' || (v.decision === 'sin_foto' && !v.waitingPhoto)).length,
      lastImportedAt: ordered.reduce<string | null>((max, v) => (v.createdAt && (!max || v.createdAt > max) ? v.createdAt : max), null),
    }
  })
  batches.sort((a, b) => (b.lastImportedAt ?? '').localeCompare(a.lastImportedAt ?? '') || a.batch.localeCompare(b.batch))
  return { pending: batches.reduce((n, b) => n + b.pending.length, 0), batches }
}

/** Every catalogue draft with its ingredient names and step count, and how many of each batch are out. */
export async function loadDraftRows(db: Db = defaultDb): Promise<{ rows: DraftRow[]; publishedByBatch: Record<string, number> }> {
  const base = await db
    .select({
      id: recipes.id,
      name: recipes.name,
      importBatch: recipes.importBatch,
      catalogSource: recipes.catalogSource,
      imageUrl: recipes.imageUrl,
      servings: recipes.servings,
      totalTime: recipes.totalTime,
      difficulty: recipes.difficulty,
      tips: recipes.tips,
      tags: recipes.tags,
      createdAt: recipes.createdAt,
    })
    .from(recipes)
    .where(and(isNull(recipes.authorId), eq(recipes.status, DRAFT)))
    .orderBy(asc(recipes.createdAt), asc(recipes.id))
  const ids = base.map((r) => r.id)
  const ings = ids.length
    ? await db
        .select({ recipeId: recipeIngredients.recipeId, name: ingredients.name })
        .from(recipeIngredients)
        .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId))
        .where(inArray(recipeIngredients.recipeId, ids))
        .orderBy(asc(recipeIngredients.displayOrder))
    : []
  const steps = ids.length
    ? await db
        .select({ recipeId: recipeSteps.recipeId, n: sql<number>`count(*)::int` })
        .from(recipeSteps)
        .where(inArray(recipeSteps.recipeId, ids))
        .groupBy(recipeSteps.recipeId)
    : []
  const batchIds = [...new Set(base.map((r) => r.importBatch).filter((b): b is string => !!b))]
  const published = batchIds.length
    ? await db
        .select({ batch: recipes.importBatch, n: sql<number>`count(*)::int` })
        .from(recipes)
        .where(and(inArray(recipes.importBatch, batchIds), eq(recipes.status, PUBLISHED), isNull(recipes.authorId)))
        .groupBy(recipes.importBatch)
    : []
  const ingsBy = new Map<string, string[]>()
  for (const i of ings) ingsBy.set(i.recipeId, [...(ingsBy.get(i.recipeId) ?? []), i.name])
  const stepsBy = new Map(steps.map((s) => [s.recipeId, Number(s.n)]))
  return {
    rows: base.map((r) => ({
      ...r,
      catalogSource: (r.catalogSource ?? null) as Partial<CatalogSourceInfo> | null,
      ingredients: ingsBy.get(r.id) ?? [],
      stepCount: stepsBy.get(r.id) ?? 0,
    })),
    publishedByBatch: Object.fromEntries(published.map((p) => [p.batch ?? '', Number(p.n)])),
  }
}

export async function loadCatalogDrafts(db: Db = defaultDb): Promise<CatalogDraftsView> {
  const { rows, publishedByBatch } = await loadDraftRows(db)
  return buildDraftsView(rows, publishedByBatch)
}

// ─── Miguel's verdict, recipe by recipe ─────────────────────────

export type DraftActionResult =
  | { ok: true; id: string; name: string; batch: string; wishesCovered?: number; waitingPhoto?: boolean }
  | { ok: false; code: 'NOT_FOUND' }
  | { ok: false; code: 'AUDIT_HOLD'; issues: Array<{ code: string; label: string }> }

async function lockDraft(tx: Tx, id: string) {
  const [row] = await tx
    .select({ id: recipes.id, name: recipes.name, importBatch: recipes.importBatch, catalogSource: recipes.catalogSource, imageUrl: recipes.imageUrl })
    .from(recipes)
    .where(and(eq(recipes.id, id), isNull(recipes.authorId), eq(recipes.status, DRAFT)))
    .for('update')
  if (!row) return null
  const source = (row.catalogSource ?? {}) as Partial<CatalogSourceInfo>
  return { ...row, source, batch: row.importBatch ?? text(source.batch) ?? 'sin-tanda' }
}

/**
 * «Publicar»: Miguel's OK (`review --ok`) and this recipe out, in one go —
 * unless the audit holds it (the rule holds audit issues whatever the source).
 * Closes the catalogue wishes it covers. Without its photo yet, the OK is
 * kept and the recipe goes out by itself once the photo is made
 * (`waitingPhoto`, catalogPhotos.ts).
 */
export async function publishCatalogDraft(id: string, adminId: string, db: Db = defaultDb, wake: () => void = wakeCatalogPhotos): Promise<DraftActionResult> {
  const result = await db.transaction(async (tx) => {
    const row = await lockDraft(tx, id)
    if (!row) return { ok: false, code: 'NOT_FOUND' } as const
    const issues = auditOf(row.source)
    const decision = reviewDecision({ origin: originOf(row.source), auditIssues: issues, reviewOk: true, hasPhoto: !!row.imageUrl })
    if (decision === 'auditoria') {
      return { ok: false, code: 'AUDIT_HOLD', issues: auditLabels(issues) } as const
    }
    if (decision === 'sin_foto') {
      const catalogSource = { ...row.source, reviewOk: true, reviewedAt: new Date().toISOString(), publishWhenPhoto: true } as CatalogSourceInfo
      await tx.update(recipes).set({ catalogSource }).where(eq(recipes.id, id))
      await record({ adminId, action: 'catalog_draft.publish', targetType: 'recipe', targetId: id, payload: { name: row.name, batch: row.batch, origin: originOf(row.source), waitingPhoto: true } }, tx)
      return { ok: true, id, name: row.name, batch: row.batch, waitingPhoto: true } as const
    }
    const catalogSource = { ...row.source, reviewOk: true, reviewedAt: new Date().toISOString() } as CatalogSourceInfo
    await tx.update(recipes).set({ status: PUBLISHED, catalogSource, updatedAt: new Date() }).where(eq(recipes.id, id))
    const wishesCovered = await markWishesCovered([{ id, name: row.name }], tx)
    await record({ adminId, action: 'catalog_draft.publish', targetType: 'recipe', targetId: id, payload: { name: row.name, batch: row.batch, origin: originOf(row.source), wishesCovered } }, tx)
    return { ok: true, id, name: row.name, batch: row.batch, wishesCovered } as const
  })
  if (result.ok && result.waitingPhoto) wake()
  return result
}

/** «Descartar»: Miguel's «no» (`review --no`). The draft stays hidden, so a re-import skips it. */
export async function discardCatalogDraft(id: string, adminId: string, db: Db = defaultDb): Promise<DraftActionResult> {
  return db.transaction(async (tx) => {
    const row = await lockDraft(tx, id)
    if (!row) return { ok: false, code: 'NOT_FOUND' } as const
    const catalogSource = { ...row.source, reviewOk: false, reviewedAt: new Date().toISOString() } as CatalogSourceInfo
    await tx.update(recipes).set({ catalogSource }).where(eq(recipes.id, id))
    await record({ adminId, action: 'catalog_draft.discard', targetType: 'recipe', targetId: id, payload: { name: row.name, batch: row.batch, origin: originOf(row.source) } }, tx)
    return { ok: true, id, name: row.name, batch: row.batch } as const
  })
}

/** «Recuperar»: the verdict is taken back; the draft is «sin revisar» again. */
export async function restoreCatalogDraft(id: string, adminId: string, db: Db = defaultDb): Promise<DraftActionResult> {
  return db.transaction(async (tx) => {
    const row = await lockDraft(tx, id)
    if (!row) return { ok: false, code: 'NOT_FOUND' } as const
    const { reviewOk: before, reviewedAt: _at, ...rest } = row.source
    await tx.update(recipes).set({ catalogSource: rest as CatalogSourceInfo }).where(eq(recipes.id, id))
    await record({ adminId, action: 'catalog_draft.restore', targetType: 'recipe', targetId: id, payload: { name: row.name, batch: row.batch, before: before ?? null } }, tx)
    return { ok: true, id, name: row.name, batch: row.batch } as const
  })
}

export interface BatchPublishResult {
  published: number
  wishesCovered: number
  held: Array<{ id: string; name: string; reason: HoldReason }>
}

/**
 * «Publicar las aprobadas»: what the rule allows in this batch goes out (same
 * as `publish --batch=…`); the ones still waiting for their photo go out by
 * themselves once it's made.
 */
export async function publishApprovedInBatch(batch: string, adminId: string, db: Db = defaultDb, wake: () => void = wakeCatalogPhotos): Promise<BatchPublishResult> {
  const result = await db.transaction(async (tx) => {
    const res = await publishBatch(batch, {}, tx)
    const waiting = res.plan.hold.some((h) => h.reason === 'sin_foto')
    if (res.published > 0 || waiting) {
      const heldBy = res.plan.hold.reduce<Record<string, number>>((acc, h) => ({ ...acc, [h.reason]: (acc[h.reason] ?? 0) + 1 }), {})
      await record({ adminId, action: 'catalog_batch.publish', targetType: 'catalog_batch', targetId: batch, payload: { published: res.published, ids: res.plan.publish, wishesCovered: res.wishesCovered, held: heldBy } }, tx)
    }
    return { published: res.published, wishesCovered: res.wishesCovered, held: res.plan.hold }
  })
  if (result.held.some((h) => h.reason === 'sin_foto')) wake()
  return result
}

/** Before importing: which recipes of the file the catalogue already has, and how many the batch already holds. */
export async function previewImport(names: readonly string[], batch: string, db: Db = defaultDb): Promise<{ recipes: Array<{ name: string; duplicateOf: string | null }>; alreadyInBatch: number }> {
  const [catalog, inBatch] = await Promise.all([
    allCatalogNames(db),
    db.select({ n: sql<number>`count(*)::int` }).from(recipes).where(and(eq(recipes.importBatch, batch), isNull(recipes.authorId))),
  ])
  return { recipes: previewDuplicates(names, catalog), alreadyInBatch: Number(inBatch[0]?.n ?? 0) }
}
