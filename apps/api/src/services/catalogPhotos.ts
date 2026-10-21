/**
 * Every catalogue recipe has its house photo before anyone can open it
 * (Miguel, 2026-10-21: «debería generarse antes de que nadie pudiera
 * acceder»; specs/catalog-import.md → Photos).
 *
 * A catalogue draft — imported by the command or from «Recetas pendientes» —
 * gets its photo here, in the API (the only process that can write to the
 * photo volume), and publishing waits for it (`reviewDecision` → «sin_foto»).
 * A publish asked for while the photo was still missing (`publishWhenPhoto`)
 * goes out as soon as the photo is saved, if the rule still allows it.
 *
 * One recipe at a time: 30 s after boot, every 10 minutes, and right away
 * when an import saves a draft or Miguel asks to publish one
 * (`wakeCatalogPhotos`). Order: recipes already published without a photo,
 * then the ones waiting to go out, then the other drafts. A discarded draft
 * never costs a photo. Each recipe is tried once every 6 hours at most
 * (`claimCatalogPhoto`, shared with the on-demand path): a photo the checker
 * turned down twice isn't paid for again on every pass; a call that failed
 * (network) is tried again on the next pass. Cost lands on Mimoia (system
 * recipe: no author).
 */
import { and, inArray, isNull } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { recipes, type CatalogSourceInfo } from '../db/schema.js'
import { claimCatalogPhoto, releaseCatalogPhoto } from './catalogImageOnDemand.js'
import { publishIfWaitingForPhoto } from './catalogImportDb.js'
import { runWithCostUser } from './costLedger.js'
import { applyHouseImage, type ApplyOutcome } from './recipeHouseImage.js'
import { imageGenerationConfigured } from './recipeImageGenerator.js'
import { DRAFT, PUBLISHED } from './recipeVisibility.js'

export interface PhotoCandidate {
  id: string
  status: string
  imageUrl: string | null
  catalogSource: Partial<CatalogSourceInfo> | null
}

/**
 * Pure: the catalogue recipes that need a photo, in the order they get it —
 * published ones first (someone may be looking at them), then drafts whose
 * publish is waiting for the photo, then the other drafts.
 */
export function photoQueue(rows: readonly PhotoCandidate[]): string[] {
  const rank = (r: PhotoCandidate) => (r.status === PUBLISHED ? 0 : r.catalogSource?.publishWhenPhoto ? 1 : 2)
  return rows
    .filter((r) => !r.imageUrl && (r.status === PUBLISHED || r.status === DRAFT) && r.catalogSource?.reviewOk !== false)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map(({ r }) => r.id)
}

export interface PhotoSweepDeps {
  load: () => Promise<PhotoCandidate[]>
  makePhoto: (id: string) => Promise<ApplyOutcome>
  /** Publishes the draft if its publish was waiting for the photo; true when it went out. */
  publishIfWaiting: (id: string) => Promise<boolean>
  claim: (id: string) => boolean
  release: (id: string) => void
  log: (line: string) => void
}

export interface PhotoSweepResult {
  saved: number
  published: number
  rejected: number
  failed: number
}

/** One pass over the queue (deps injected). Never throws for one recipe. */
export async function sweepCatalogPhotos(deps: PhotoSweepDeps): Promise<PhotoSweepResult> {
  const out: PhotoSweepResult = { saved: 0, published: 0, rejected: 0, failed: 0 }
  for (const id of photoQueue(await deps.load())) {
    if (!deps.claim(id)) continue
    try {
      const made = await deps.makePhoto(id)
      if (made.status === 'rejected') {
        out.rejected += 1
        deps.log(`[catalogPhotos] ${id}: photo turned down by the check (${made.verdict?.reason ?? 'no reason'})`)
        continue
      }
      if (made.status === 'saved') out.saved += 1
      if (await deps.publishIfWaiting(id)) out.published += 1
    } catch (err) {
      out.failed += 1
      deps.release(id)
      deps.log(`[catalogPhotos] ${id} failed: ${(err as Error)?.message ?? err}`)
    }
  }
  return out
}

const realDeps: PhotoSweepDeps = {
  load: () =>
    db
      .select({ id: recipes.id, status: recipes.status, imageUrl: recipes.imageUrl, catalogSource: recipes.catalogSource })
      .from(recipes)
      .where(and(isNull(recipes.authorId), isNull(recipes.imageUrl), inArray(recipes.status, [DRAFT, PUBLISHED])))
      .orderBy(recipes.createdAt) as Promise<PhotoCandidate[]>,
  makePhoto: (id) => applyHouseImage(id),
  publishIfWaiting: (id) => publishIfWaitingForPhoto(id),
  claim: (id) => claimCatalogPhoto(id),
  release: (id) => releaseCatalogPhoto(id),
  log: (line) => console.warn(line),
}

const INTERVAL_MS = 10 * 60_000
const FIRST_RUN_MS = 30_000

let running: Promise<void> | null = null
let again = false
let timer: ReturnType<typeof setInterval> | null = null

function enabled(): boolean {
  return imageGenerationConfigured() && process.env.NODE_ENV !== 'test' && !process.env.VITEST
}

/** Start a pass now (or one more right after the current one). Fire-and-forget. */
export function wakeCatalogPhotos(): void {
  if (!enabled()) return
  if (running) {
    again = true
    return
  }
  running = runWithCostUser(null, async () => {
    do {
      again = false
      try {
        const r = await sweepCatalogPhotos(realDeps)
        if (r.saved || r.rejected || r.failed) console.info(`[catalogPhotos] ${r.saved} photos, ${r.published} published, ${r.rejected} turned down, ${r.failed} failed`)
      } catch (err) {
        console.warn('[catalogPhotos] pass failed:', (err as Error)?.message ?? err)
      }
    } while (again)
  }).finally(() => {
    running = null
  })
}

/** Boot: a first pass in 30 s, then every 10 minutes. Idempotent. */
export function startCatalogPhotos(): void {
  if (timer || !enabled()) return
  setTimeout(wakeCatalogPhotos, FIRST_RUN_MS).unref?.()
  timer = setInterval(wakeCatalogPhotos, INTERVAL_MS)
  timer.unref?.()
}
