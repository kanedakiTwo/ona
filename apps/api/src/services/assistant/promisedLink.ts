import { shortWebLink } from '../menuText.js'

/**
 * PRO-1301: when Mimo says it sends a link to the app («te paso el enlace del
 * menú»), the link is added by code, not left to the model. 2026-11 history:
 * Mimo promised the link to the app, didn't write it, and the household had
 * to ask again.
 *
 * Pure. Only links to the app: a reply about the video a recipe came from,
 * an invitation or another web is left as it is.
 */

/** «te paso / dejo / mando… el enlace», «aquí tienes el enlace», «en este enlace», «enlace:» at the end. */
const ANNOUNCES_LINK_RE =
  /\b(?:te|os)\s+(?:lo\s+|la\s+)?(?:paso|dejo|mando|env[ií]o|pongo|comparto|adjunto|copio)\b[^.\n?!]{0,50}\b(?:enlace|link)\b|\b(?:aqu[ií]|ah[ií])\s+(?:tienes|ten[eé]is|va|est[aá]|lo\s+tienes)\s+(?:el|tu|vuestro)\s+(?:enlace|link)\b|\b(?:en|desde)\s+este\s+(?:enlace|link)\b|\b(?:enlace|link)\b[^.\n?!]{0,40}\b(?:abajo|debajo|a\s+continuaci[oó]n)\b|\b(?:enlace|link)\s*:\s*$/im

/** Links that aren't to the app: never answered with one. */
const OTHER_LINK_RE = /\b(?:v[ií]deo|youtube|instagram|tiktok|invita\w*|origen|original|fuente|blog|p[aá]gina\s+web)\b/i

/** Any link already written (full or short form like mimoia.com/menu). */
const HAS_LINK_RE = /https?:\/\/\S+|\b[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\/\S*/i

/** The app page a reply talks about, in order: the first that matches. */
const TOPIC_PATHS: ReadonlyArray<[RegExp, string]> = [
  [/\b(?:lista|compra)\b/i, '/shopping'],
  [/\bavisos?\b/i, '/profile/avisos'],
  [/\bajustes\b/i, '/profile/ajustes'],
  [/\bperfil\b/i, '/profile'],
  [/\brecetas\b/i, '/recipes'],
]

/** Pure: the path of the app page a reply about a link means (the week's menu by default). */
export function appPathFor(text: string, recipeId?: string | null): string {
  if (recipeId && /\breceta\b/i.test(text)) return `/recipes/${recipeId}`
  for (const [re, path] of TOPIC_PATHS) if (re.test(text)) return path
  return '/menu'
}

/** The sentence that announces a link to the app, when the reply has one and no link written. */
function announcingSentence(text: string): string | null {
  if (!text || HAS_LINK_RE.test(text)) return null
  const m = ANNOUNCES_LINK_RE.exec(text)
  if (!m) return null
  const start = Math.max(text.lastIndexOf('.', m.index), text.lastIndexOf('\n', m.index)) + 1
  const end = text.slice(m.index + m[0].length).search(/[.\n?!]/)
  const sentence = text.slice(start, end < 0 ? undefined : m.index + m[0].length + end + 1)
  // The sentence decides what it is a link to.
  return OTHER_LINK_RE.test(sentence) ? null : sentence
}

/** Pure: does the reply announce a link to the app without writing it? */
export function promisesAppLink(text: string): boolean {
  return announcingSentence(text) !== null
}

/**
 * Pure: the reply with the app link added when it announces one and has
 * none (the page its announcing sentence talks about). A reply ending in «:»
 * gets it right after; otherwise on its own line.
 */
export function withPromisedAppLink(text: string, webUrl: string, recipeId?: string | null): string {
  const sentence = announcingSentence(text)
  if (sentence === null) return text
  const link = shortWebLink(webUrl, appPathFor(sentence, recipeId))
  const trimmed = text.trimEnd()
  return trimmed.endsWith(':') ? `${trimmed} ${link}` : `${trimmed}\n\n${link}`
}
