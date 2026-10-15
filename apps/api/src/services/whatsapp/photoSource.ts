import type { HistoryRow } from './history.js'
import { SOCIAL_SCREENSHOT_MESSAGE } from '../sources/social.js'

/**
 * PRO-66: the link to the original of a recipe imported from a screenshot.
 * Pure (reads the stored WhatsApp rows), unit-tested in
 * `whatsappPhotoSource.test.ts`; `inbound.ts` wires it.
 *
 * Three cases:
 *  1. The user sent an Instagram/TikTok link we couldn't read («mándame una
 *     captura», PRO-30) in the last 30 minutes → the recipe of the next photo
 *     is saved with that link as its source, without asking.
 *  2. No such link, and the photo looks like a screenshot of a web page or a
 *     social network → Mimo asks «¿Tienes el enlace del original?»; a link
 *     sent in the next 30 minutes becomes that recipe's source (not a new
 *     recipe).
 *  3. A cookbook page or a handwritten note → no question.
 */

export const PHOTO_SOURCE_WINDOW_MS = 30 * 60 * 1000

export const ASK_SOURCE_COPY = '¿Tienes el enlace del original? Así lo guardo como fuente.'

/** What a photo import leaves in its inbound row's `meta`. */
export interface PhotoSourceMeta {
  photo?: boolean
  /** The recipe the photo was saved as. */
  photoRecipeId?: string
  photoRecipeName?: string
  /** Case 1: the unreadable link used as the source. */
  photoSourceUrl?: string
  /** Case 2: Mimo asked for the link. */
  sourceAsked?: boolean
  /** On the row of the link that answered the question: the recipe it went to. */
  sourceAttachedTo?: string
}

const URL_RE = /https?:\/\/[^\s"'<>\\]+/i

/** The first http(s) link in a text, without trailing punctuation. */
export function firstUrl(text: string | null | undefined): string | null {
  const m = (text ?? '').match(URL_RE)
  if (!m) return null
  const url = m[0].replace(/[).,;:!?»…]+$/, '')
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function metaOf(row: HistoryRow): (PhotoSourceMeta & { toolTrace?: unknown }) | null {
  return row.meta && typeof row.meta === 'object' ? (row.meta as PhotoSourceMeta & { toolTrace?: unknown }) : null
}

function recentInbound(rows: readonly HistoryRow[], now: Date): HistoryRow[] {
  const since = now.getTime() - PHOTO_SOURCE_WINDOW_MS
  return rows
    .filter((r) => r.direction === 'in' && r.createdAt.getTime() >= since && r.createdAt.getTime() <= now.getTime())
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

/**
 * Case 1: the Instagram/TikTok link of the last 30 minutes that got «mándame
 * una captura», unless a later photo already took it as its source.
 */
export function unreadLinkForScreenshot(rows: readonly HistoryRow[], now: Date): string | null {
  const inbound = recentInbound(rows, now)
  for (let i = inbound.length - 1; i >= 0; i--) {
    const trace = metaOf(inbound[i])?.toolTrace
    if (!Array.isArray(trace)) continue
    const failed = trace.find(
      (t) =>
        t && t.name === 'import_recipe_from_url' &&
        typeof t.summary === 'string' && t.summary.includes(SOCIAL_SCREENSHOT_MESSAGE),
    )
    const url = failed ? firstUrl(String(failed.input ?? '')) : null
    if (!url) continue
    const used = inbound.slice(i + 1).some((r) => metaOf(r)?.photoSourceUrl === url)
    return used ? null : url
  }
  return null
}

/**
 * Case 2: the recipe Mimo asked the link for in the last 30 minutes, if that
 * question is still open: no link answered it yet and no newer photo came in.
 */
export function pendingSourceQuestion(
  rows: readonly HistoryRow[],
  now: Date,
): { recipeId: string; name: string } | null {
  const inbound = recentInbound(rows, now)
  for (let i = inbound.length - 1; i >= 0; i--) {
    const meta = metaOf(inbound[i])
    if (!meta?.photoRecipeId) continue
    // The latest photo import decides: a newer photo closes an older question.
    if (!meta.sourceAsked) return null
    const answered = inbound.slice(i + 1).some((r) => metaOf(r)?.sourceAttachedTo === meta.photoRecipeId)
    return answered ? null : { recipeId: meta.photoRecipeId, name: meta.photoRecipeName ?? 'la receta' }
  }
  return null
}
