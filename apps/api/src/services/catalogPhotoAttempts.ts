/**
 * Catalogue photos don't repeat without end (PRO-1313, D-164: «Ahorro de
 * API»; specs/catalog-import.md → Photos). Each try at a catalogue recipe's
 * photo is kept in the recipe (`catalog_source.photoAttempts`), not only in
 * memory: after 2 turn-downs by the checker (`photoRejections`) the recipe
 * stops asking by itself — not on the next pass, not after a restart — and
 * «Recetas pendientes» shows it as «Foto rechazada», with «Pedir otra foto»
 * (`retryCatalogPhoto` in catalogReview.ts) to put it back in the queue.
 *
 * Both paths that ask for a catalogue photo go through `tryCatalogPhoto`:
 * the job (catalogPhotos.ts) and the on-demand safety net
 * (catalogImageOnDemand.ts). A call that failed before the checker (network)
 * isn't a turn-down and isn't counted.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { recipes, type CatalogPhotoAttempt, type CatalogSourceInfo } from '../db/schema.js'
import { runWithCostUser } from './costLedger.js'
import { applyHouseImage, type ApplyOutcome } from './recipeHouseImage.js'
import { imageGenerationConfigured } from './recipeImageGenerator.js'

/** Turn-downs after which the recipe waits for «Pedir otra foto». */
export const MAX_PHOTO_REJECTIONS = 2
/** After a turn-down, the next try waits this long (also across restarts). */
export const PHOTO_RETRY_MS = 6 * 60 * 60_000
const KEEP_ATTEMPTS = 10

type Source = Partial<CatalogSourceInfo> | null | undefined

/** Pure: the checker turned its photo down too many times; only the button asks again. */
export function photoGivenUp(source: Source): boolean {
  return (source?.photoRejections ?? 0) >= MAX_PHOTO_REJECTIONS
}

/** Pure: the last try was a turn-down less than 6 hours ago (and no «Pedir otra foto» since). */
export function photoRecentlyRejected(source: Source, now: number = Date.now()): boolean {
  if (!source?.photoRejections) return false
  const last = source.photoAttempts?.at(-1)
  if (!last || last.outcome !== 'rejected') return false
  const at = Date.parse(last.at)
  return Number.isFinite(at) && now - at < PHOTO_RETRY_MS
}

/** Pure: the reason of the last turn-down, if the last try was one. */
export function lastPhotoRejection(source: Source): string | null {
  const last = source?.photoAttempts?.at(-1)
  return last?.outcome === 'rejected' ? last.reason?.trim() || null : null
}

/** Pure: the source with one more try written down. */
export function withPhotoAttempt(source: Source, attempt: CatalogPhotoAttempt): Partial<CatalogSourceInfo> {
  const s = source ?? {}
  const photoAttempts = [...(Array.isArray(s.photoAttempts) ? s.photoAttempts : []), attempt].slice(-KEEP_ATTEMPTS)
  const photoRejections = attempt.outcome === 'rejected' ? (s.photoRejections ?? 0) + 1 : 0
  return { ...s, photoAttempts, photoRejections }
}

/** Pure: «Pedir otra foto» — the count starts again (and the 6-hour wait with it); the history stays. */
export function withPhotoRetry(source: Source): Partial<CatalogSourceInfo> {
  return { ...(source ?? {}), photoRejections: 0 }
}

async function loadSource(id: string): Promise<{ found: boolean; source: Source }> {
  const [row] = await db
    .select({ catalogSource: recipes.catalogSource })
    .from(recipes)
    .where(and(eq(recipes.id, id), isNull(recipes.authorId)))
    .limit(1)
  return { found: !!row, source: (row?.catalogSource ?? null) as Source }
}

/** Write one try into the recipe (row locked: the job and a page view may finish together). */
export async function recordPhotoAttempt(id: string, attempt: CatalogPhotoAttempt): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ catalogSource: recipes.catalogSource })
      .from(recipes)
      .where(and(eq(recipes.id, id), isNull(recipes.authorId)))
      .for('update')
    if (!row) return
    const catalogSource = withPhotoAttempt(row.catalogSource as Source, attempt) as CatalogSourceInfo
    await tx.update(recipes).set({ catalogSource }).where(eq(recipes.id, id))
  })
}

export type CatalogPhotoOutcome = ApplyOutcome | { status: 'given_up' }

export interface CatalogPhotoDeps {
  load: (id: string) => Promise<{ found: boolean; source: Source }>
  make: (id: string) => Promise<ApplyOutcome>
  record: (id: string, attempt: CatalogPhotoAttempt) => Promise<void>
  now: () => Date
}

const realDeps: CatalogPhotoDeps = {
  load: loadSource,
  make: (id) => applyHouseImage(id),
  record: recordPhotoAttempt,
  now: () => new Date(),
}

/**
 * One try at a catalogue recipe's photo, written down in the recipe. Nothing
 * is paid for a recipe given up on or turned down in the last 6 hours.
 * Throws when the call failed (nothing recorded: the next pass tries again).
 */
export async function tryCatalogPhoto(id: string, deps: CatalogPhotoDeps = realDeps): Promise<CatalogPhotoOutcome> {
  const { found, source } = await deps.load(id)
  if (!found) return { status: 'skipped', reason: 'not_found' }
  if (photoGivenUp(source) || photoRecentlyRejected(source, deps.now().getTime())) return { status: 'given_up' }
  const made = await deps.make(id)
  const at = deps.now().toISOString()
  if (made.status === 'rejected') await deps.record(id, { at, outcome: 'rejected', reason: made.verdict?.reason ?? null })
  else if (made.status === 'saved') await deps.record(id, { at, outcome: 'saved' })
  return made
}

/** On-demand path (a menu or a visit): fire-and-forget; no-op without an image provider or under tests. Cost on Mimoia. */
export function scheduleCatalogPhoto(id: string): void {
  if (!imageGenerationConfigured() || process.env.NODE_ENV === 'test' || process.env.VITEST) return
  void runWithCostUser(null, async () => {
    try {
      const out = await tryCatalogPhoto(id)
      if (out.status !== 'saved') console.info(`[catalogPhoto] ${id}: ${out.status}`)
    } catch (err) {
      console.warn(`[catalogPhoto] ${id} failed:`, (err as Error)?.message ?? err)
    }
  })
}
