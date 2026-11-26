/**
 * PRO-1301: when importing a link fails, Mimo says why in one sentence
 * (private video, no text, a network we don't read) and what does work.
 * 2026-11 history: Mimo invited a household to paste a video link, the
 * import failed, and it asked for a screenshot without saying why.
 *
 * Pure (no network): the skill and its tests use it.
 */
import { NeedsScreenshotError } from './needsScreenshot.js'
import { SocialCaptionUnavailableError } from './social.js'
import { NoExtractableContentError } from './youtube.js'
import { PageFetchError, UnsafeUrlError } from '../net/publicFetch.js'

/** What the import reads, said the same way everywhere (the skill, the prompt). */
export const IMPORT_WORKS =
  'Sí puedo con vídeos de YouTube (con subtítulos o la receta en la descripción), posts públicos de Instagram o TikTok con la receta escrita en el texto y webs de recetas; y si no, mándame una foto o captura de la receta.'

/** Networks the import doesn't read (their pages need a login or have no recipe text). */
const UNSUPPORTED: ReadonlyArray<[RegExp, string]> = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.watch)$/, 'Facebook'],
  [/(^|\.)(x\.com|twitter\.com|t\.co)$/, 'X (Twitter)'],
  [/(^|\.)(pinterest\.[a-z.]+|pin\.it)$/, 'Pinterest'],
  [/(^|\.)threads\.(net|com)$/, 'Threads'],
  [/(^|\.)snapchat\.com$/, 'Snapchat'],
  [/(^|\.)vimeo\.com$/, 'Vimeo'],
  [/(^|\.)twitch\.tv$/, 'Twitch'],
  [/(^|\.)kwai\.com$/, 'Kwai'],
]

/** Pure: the name of a network the import can't read, or null. */
export function unsupportedNetwork(url: string): string | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  return UNSUPPORTED.find(([re]) => re.test(host))?.[1] ?? null
}

/** Pure: the one sentence that says why it failed (null = not an import failure we know). */
export function importFailureReason(err: unknown): string | null {
  if (err instanceof SocialCaptionUnavailableError) {
    return err.reason === 'private'
      ? 'No he podido abrir ese vídeo: es privado o pide iniciar sesión.'
      : 'Ese vídeo no trae la receta escrita en su texto, y el vídeo en sí no lo puedo ver.'
  }
  if (err instanceof NoExtractableContentError) {
    return err.reason === 'private'
      ? 'No he podido abrir ese vídeo: es privado o ya no está disponible.'
      : 'Ese enlace no trae la receta escrita (ingredientes y pasos, en subtítulos o en el texto), y un vídeo en sí no lo puedo ver.'
  }
  if (err instanceof NeedsScreenshotError) return 'Esa página no me deja leer la receta: no trae el texto.'
  if (err instanceof PageFetchError) return 'No he podido abrir esa página: no responde o ya no existe.'
  if (err instanceof UnsafeUrlError) return 'Ese enlace no es una página pública.'
  return null
}

/** Pure: what Mimo says, motive first and then what works. */
export function importFailureReply(reason: string): string {
  return `${reason} ${IMPORT_WORKS}`
}

/** Pure: the reply for a network the import doesn't read. */
export function unsupportedNetworkReply(network: string): string {
  return importFailureReply(`Los enlaces de ${network} no los puedo leer.`)
}
