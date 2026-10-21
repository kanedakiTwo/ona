/**
 * Safety net for catalogue photos (PRO-154, specs/catalog-import.md). Since
 * 2026-10-21 a catalogue recipe gets its photo as a draft and isn't
 * published without it (catalogPhotos.ts). If one is still published
 * without a photo (a photo the checker turned down, the API down while it
 * was imported), its house photo is asked for the moment it shows up in a
 * menu or someone opens it — through the usual background generator
 * (`scheduleHouseImage`, recipeHouseImage.ts), whose cost lands on Mimoia
 * (system recipe: no author).
 *
 * Only catalogue recipes with no image at all; user recipes already get
 * theirs at import time. A recipe is asked for once every 6 hours at most
 * (`claimCatalogPhoto`, shared with catalogPhotos.ts), so a recipe that sits
 * in 50 menus at once asks once, a rejected photo isn't retried on every
 * page view, and the two paths never pay twice for the same photo.
 */
import { scheduleHouseImage } from './recipeHouseImage.js'

export interface ImageCandidate {
  id: string
  authorId: string | null
  imageUrl: string | null
  status?: string | null
}

type Scheduler = (recipeId: string, authorId: string | null) => void

const CLAIM_MS = 6 * 60 * 60_000
/** Recipe id → when its photo was last asked for (this process). */
const claims = new Map<string, number>()

/** True when nobody asked for this photo in the last 6 hours (and marks it asked). */
export function claimCatalogPhoto(id: string, now: number = Date.now()): boolean {
  const at = claims.get(id)
  if (at != null && now - at < CLAIM_MS) return false
  claims.set(id, now)
  return true
}

/** The ask failed before trying (network): let the next pass try again. */
export function releaseCatalogPhoto(id: string): void {
  claims.delete(id)
}

function recentlyClaimed(now: number = Date.now()): Set<string> {
  return new Set([...claims].filter(([, at]) => now - at < CLAIM_MS).map(([id]) => id))
}

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
    const ids = recipesNeedingPhoto(rows, recentlyClaimed())
    for (const id of ids) {
      claimCatalogPhoto(id)
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
  claims.clear()
}
