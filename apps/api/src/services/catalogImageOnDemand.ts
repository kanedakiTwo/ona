/**
 * Photos on demand for the catalogue (PRO-154, specs/catalog-import.md):
 * a batch-imported recipe is saved without a photo (1.000 photos up front
 * ≈ 64 €). Its house photo is made the first time it shows up in a menu or
 * someone opens it — through the usual background generator
 * (`scheduleHouseImage`, recipeHouseImage.ts), whose cost lands on Mimoia
 * (system recipe: no author).
 *
 * Only catalogue recipes with no image at all; user recipes already get
 * theirs at import time. One request per recipe per process, so a recipe
 * that sits in 50 menus at once asks once (and a rejected photo isn't
 * retried on every page view; a restart lets it try again).
 */
import { scheduleHouseImage } from './recipeHouseImage.js'

export interface ImageCandidate {
  id: string
  authorId: string | null
  imageUrl: string | null
  status?: string | null
}

type Scheduler = (recipeId: string, authorId: string | null) => void

const requested = new Set<string>()

/** Pure: the recipes that need a photo now (catalogue, published, no image, not asked yet). */
export function recipesNeedingPhoto(rows: readonly ImageCandidate[], alreadyRequested: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const r of rows) {
    if (r.authorId != null) continue
    if (r.status === 'draft') continue
    if (r.imageUrl) continue
    if (alreadyRequested.has(r.id) || out.includes(r.id)) continue
    out.push(r.id)
  }
  return out
}

/**
 * Ask for the house photo of every catalogue recipe in `rows` that has none.
 * Fire-and-forget; never throws. Returns the ids it asked for.
 */
export function requestCatalogPhotos(rows: readonly ImageCandidate[], schedule: Scheduler = scheduleHouseImage): string[] {
  try {
    const ids = recipesNeedingPhoto(rows, requested)
    for (const id of ids) {
      requested.add(id)
      schedule(id, null)
    }
    return ids
  } catch (err) {
    console.warn('[catalogPhoto] request failed (ignored):', (err as Error)?.message ?? err)
    return []
  }
}

/** Tests only. */
export function _resetRequestedPhotos(): void {
  requested.clear()
}
