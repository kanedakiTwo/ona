/**
 * One file sent to Mimo with a message (2026-11-26: «pásale a Mimo la dieta
 * de tu nutricionista»): a photo (JPEG, PNG, WebP) or a PDF, from the web
 * chat's clip button or a PDF on WhatsApp that isn't the school menu.
 *
 * The file goes to the model for this turn only and is never stored: the
 * conversation keeps «[Adjunto]» in its place (`withAttachmentMarker`).
 */
import { SchoolMenuFileError } from '@ona/shared'
import { assertPdfFitsReader, SCHOOL_MENU_PDF_MAX_BYTES } from '../schoolMenu.js'
import { fitImageForClaude } from '../visionImage.js'

export const CHAT_ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
export type ChatAttachmentType = (typeof CHAT_ATTACHMENT_TYPES)[number]

/** Same ceiling as the school menu's PDF (Claude takes 32 MB per request, base64 included). */
export const CHAT_ATTACHMENT_MAX_BYTES = SCHOOL_MENU_PDF_MAX_BYTES

/** What the conversation keeps instead of the file. */
export const ATTACHMENT_MARKER = '[Adjunto]'

/** What Mimo reads when the person sent the file with no words. */
export const ATTACHMENT_DEFAULT_TEXT = 'Te mando este archivo.'

/** Said to the person instead of a generic error. */
export const CHAT_ATTACHMENT_COPY = {
  type: 'Solo puedo leer fotos (JPG, PNG o WebP) o un PDF.',
  too_big: 'Ese archivo es demasiado grande para leerlo (como mucho 20 MB y 100 páginas). Mándame solo las páginas que importan, o una foto o captura de ellas.',
} as const

export class ChatAttachmentError extends Error {
  constructor(public readonly reason: keyof typeof CHAT_ATTACHMENT_COPY) {
    super(CHAT_ATTACHMENT_COPY[reason])
    this.name = 'ChatAttachmentError'
  }
}

export function isChatAttachmentType(m: string | null | undefined): m is ChatAttachmentType {
  return !!m && (CHAT_ATTACHMENT_TYPES as readonly string[]).includes(m)
}

/**
 * The file as the engine takes it (`ChatOptions.images`: base64 + type; a PDF
 * becomes a `document` block). Wrong type or too big → ChatAttachmentError.
 * Photos are made smaller first (visionImage.ts), as for the school menu.
 */
export async function attachmentForModel(data: Buffer, mimeType: string | null | undefined): Promise<{ mediaType: string; data: string }> {
  if (!isChatAttachmentType(mimeType)) throw new ChatAttachmentError('type')
  if (data.length > CHAT_ATTACHMENT_MAX_BYTES) throw new ChatAttachmentError('too_big')
  if (mimeType === 'application/pdf') {
    try {
      assertPdfFitsReader(data)
    } catch (err) {
      if (err instanceof SchoolMenuFileError) throw new ChatAttachmentError('too_big')
      throw err
    }
    return { mediaType: mimeType, data: data.toString('base64') }
  }
  const fitted = await fitImageForClaude(data, mimeType)
  return { mediaType: fitted.mimeType, data: fitted.data.toString('base64') }
}

/** Pure: the person's words as the conversation keeps them, with the marker instead of the file. */
export function withAttachmentMarker(text: string | null | undefined): string {
  const t = (text ?? '').trim()
  return t ? `${ATTACHMENT_MARKER} ${t}` : ATTACHMENT_MARKER
}

const DIET_WORDS = /(^|[^\p{L}])(dieta|nutricionista|dietista|endocrin\p{L}*|m[eé]dic[oa]|pauta)(?![\p{L}])/iu

/** Pure: the words speak of a diet given by a nutritionist or doctor. */
export function mentionsDiet(text: string | null | undefined): boolean {
  return DIET_WORDS.test(text ?? '')
}

/**
 * Pure: an attachment that looks like the diet of a nutritionist or doctor
 * (event `mimo_diet_document`). A PDF counts: the only PDF that reaches Mimo
 * is one that isn't the school menu. A photo counts when the words say so.
 */
export function looksLikeDietDocument(text: string | null | undefined, mediaType: string): boolean {
  return mediaType === 'application/pdf' || mentionsDiet(text)
}
