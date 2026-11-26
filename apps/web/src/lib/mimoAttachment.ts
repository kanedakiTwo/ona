/**
 * One photo or PDF sent to Mimo with a message (2026-11-26: «pásale a Mimo la
 * dieta de tu nutricionista»). Mirrors apps/api/src/services/assistant/
 * chatAttachment.ts: same types, same 20 MB, same «[Adjunto]» marker. The file
 * is never stored; the conversation keeps the marker in its place.
 */

export const MIMO_ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const
export const MIMO_ATTACHMENT_ACCEPT = MIMO_ATTACHMENT_TYPES.join(",")
export const MIMO_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024
export const MIMO_ATTACHMENT_MARKER = "[Adjunto]"

/** The draft «¿Sigues la dieta de un nutricionista?» leaves in Mimo's box. */
export const NUTRITIONIST_DIET_DRAFT = "Te mando la dieta de mi nutricionista."

/** Pure: why this file can't go to Mimo (in Spanish), or null when it can. */
export function mimoAttachmentProblem(file: { type: string; size: number }): string | null {
  if (!(MIMO_ATTACHMENT_TYPES as readonly string[]).includes(file.type)) return "Solo puedo leer fotos (JPG, PNG o WebP) o un PDF."
  if (file.size > MIMO_ATTACHMENT_MAX_BYTES) return "Ese archivo es demasiado grande (como mucho 20 MB). Mándame solo las páginas que importan."
  return null
}

/** Pure: the person's words as the conversation keeps them, with the marker instead of the file. */
export function withAttachmentMarker(text: string): string {
  const t = text.trim()
  return t ? `${MIMO_ATTACHMENT_MARKER} ${t}` : MIMO_ATTACHMENT_MARKER
}
