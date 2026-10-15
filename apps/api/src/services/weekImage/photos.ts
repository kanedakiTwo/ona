import sharp from 'sharp'

/**
 * Downloads the recipe photos the week image shows. Best effort and quick:
 * each photo has a short timeout and a size cap, and any failure just leaves
 * that dish with a neutral tile — a photo never fails the image.
 *
 * Image URLs come in two shapes (CLAUDE.md "Recipe images"): catalogue
 * photos are relative (`/images/recipes/<slug>.jpg`, served by the web app,
 * so `WEB_PUBLIC_URL` + path) and regenerated ones are absolute (served by
 * the API from its volume).
 */

export const PHOTO_TIMEOUT_MS = 2500
export const PHOTO_MAX_BYTES = 6 * 1024 * 1024
/** Photos are drawn at most 300 px wide; keep a bit more than that in memory. */
const PHOTO_MAX_SIDE = 480
const CONCURRENCY = 8

export function absolutePhotoUrl(url: string, webUrl: string): string | null {
  const u = url.trim()
  if (/^https?:\/\//i.test(u)) return u
  if (u.startsWith('/')) return `${webUrl.replace(/\/+$/, '')}${u}`
  return null
}

async function fetchPhoto(url: string, opts: { timeoutMs: number; maxBytes: number; fetchImpl: typeof fetch }): Promise<Buffer | null> {
  try {
    const r = await opts.fetchImpl(url, { signal: AbortSignal.timeout(opts.timeoutMs) })
    if (!r.ok) return null
    const len = Number(r.headers.get('content-length') ?? 0)
    if (len > opts.maxBytes) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length === 0 || buf.length > opts.maxBytes) return null
    return await sharp(buf)
      .resize(PHOTO_MAX_SIDE, PHOTO_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer()
  } catch {
    return null
  }
}

/** recipe id → photo bytes, for the ones that could be fetched. */
export async function loadRecipePhotos(
  photos: Array<{ recipeId: string; url: string | null | undefined }>,
  opts: { webUrl: string; timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch },
): Promise<Map<string, Buffer>> {
  const conf = {
    timeoutMs: opts.timeoutMs ?? PHOTO_TIMEOUT_MS,
    maxBytes: opts.maxBytes ?? PHOTO_MAX_BYTES,
    fetchImpl: opts.fetchImpl ?? fetch,
  }
  const queue = photos
    .map((p) => ({ id: p.recipeId, url: p.url ? absolutePhotoUrl(p.url, opts.webUrl) : null }))
    .filter((p): p is { id: string; url: string } => Boolean(p.url))
  const out = new Map<string, Buffer>()
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const buf = await fetchPhoto(p.url, conf)
      if (buf) out.set(p.id, buf)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
  return out
}
