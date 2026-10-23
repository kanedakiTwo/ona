/**
 * Photos we send to Claude: upright (EXIF) and at most 1568 px on the long
 * side, as JPEG. The API refuses an image over 5 MB, and a phone camera's
 * JPEG often is one (2026-10-23: a school menu photo uploaded from the web
 * failed with «Internal server error»; the same menu through WhatsApp, which
 * compresses it, was read fine). Claude scales anything over 1568 px down
 * anyway, so nothing legible is lost.
 */
import sharp from 'sharp'

export const VISION_MAX_EDGE = 1568
/** Below Claude's 5 MB per image, with room for the base64 overhead. */
const VISION_MAX_BYTES = 3.5 * 1024 * 1024

/**
 * A photo that is already small enough goes as it is; one sharp can't read
 * goes as it is too (Claude answers for it, as before).
 */
export async function fitImageForClaude<M extends string>(data: Buffer, mimeType: M): Promise<{ data: Buffer; mimeType: M | 'image/jpeg' }> {
  try {
    const meta = await sharp(data).metadata()
    const long = Math.max(meta.width ?? 0, meta.height ?? 0)
    const upright = !meta.orientation || meta.orientation === 1
    if (long <= VISION_MAX_EDGE && data.length <= VISION_MAX_BYTES && upright) return { data, mimeType }
    const out = await sharp(data)
      .rotate()
      .resize({ width: VISION_MAX_EDGE, height: VISION_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer()
    return { data: out, mimeType: 'image/jpeg' }
  } catch {
    return { data, mimeType }
  }
}
