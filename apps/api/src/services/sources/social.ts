/**
 * Instagram / TikTok source extractor (PRO-30).
 *
 * We never download or transcribe the video. Plan A is the post's caption,
 * which both networks expose in the page head (`og:description`, with
 * `description` / `twitter:description` as fallbacks). When the caption
 * carries the recipe, it goes through the same text extractor as articles.
 * Plan B, whenever that fails (login wall, no caption, "receta en mi bio",
 * a caption with ingredients but no steps…), is to ask the user for a
 * screenshot: `SocialCaptionUnavailableError` carries the exact sentence.
 * Nothing is ever made up from a partial caption.
 */

import type {
  RawExtractedRecipe,
  TextExtractionProvider,
} from '../recipeExtractor.js'
import { fetchPublicPage, PageFetchError } from '../net/publicFetch.js'
import { extractOgImage } from './article.js'

export type SocialPlatform = 'instagram' | 'tiktok'

const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am'])
const TIKTOK_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'])

/** Pure: which social network a URL belongs to, or null for anything else. */
export function detectSocialPlatform(input: string): SocialPlatform | null {
  let host: string
  try {
    host = new URL(input).hostname.toLowerCase()
  } catch {
    return null
  }
  if (INSTAGRAM_HOSTS.has(host)) return 'instagram'
  if (TIKTOK_HOSTS.has(host)) return 'tiktok'
  return null
}

/** The one answer for every Instagram/TikTok link we can't read (web + WhatsApp). */
export const SOCIAL_SCREENSHOT_MESSAGE =
  'No he podido leer la receta de este vídeo; mándame una captura'

export class SocialCaptionUnavailableError extends Error {
  constructor() {
    super(SOCIAL_SCREENSHOT_MESSAGE)
    this.name = 'SocialCaptionUnavailableError'
  }
}

// ─── Caption parsing (pure) ──────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
}

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      return String.fromCodePoint(code)
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

function metaContents(html: string): Map<string, string> {
  const out = new Map<string, string>()
  const tagRe = /<meta\b[^>]*>/gi
  const attrRe = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let tag: RegExpExecArray | null
  while ((tag = tagRe.exec(html))) {
    const attrs: Record<string, string> = {}
    let a: RegExpExecArray | null
    attrRe.lastIndex = 0
    while ((a = attrRe.exec(tag[0]))) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? ''
    const key = (attrs.property ?? attrs.name ?? '').toLowerCase()
    if (key && attrs.content !== undefined && !out.has(key)) out.set(key, decodeHtmlEntities(attrs.content))
  }
  return out
}

/**
 * Instagram prefixes the caption with counters and the author:
 * `1.234 likes, 56 comments - cuenta on October 1, 2026: "caption"` (or the
 * Spanish `Me gusta … comentarios - cuenta el 1 de octubre de 2026: "…"`).
 * Keep only the quoted caption when that shape is recognised.
 */
function stripInstagramPrefix(text: string): string {
  const m = text.match(/^[\d.,\s\wKkMm]*(?:likes?|Me gusta)[^:]*?:\s*["“]([\s\S]*)["”]\.?\s*$/i)
  return m ? m[1] : text
}

/**
 * Pure: the post caption from the page head, or null when there is none.
 * Picks the longest of `og:description`, `description` and
 * `twitter:description` (some pages truncate one of them).
 */
export function extractSocialCaption(html: string): string | null {
  const metas = metaContents(html)
  const candidates = ['og:description', 'description', 'twitter:description']
    .map((k) => metas.get(k))
    .filter((v): v is string => typeof v === 'string')
    .map((v) => stripInstagramPrefix(v.trim()).trim())
    .filter((v) => v.length > 0)
  if (candidates.length === 0) return null
  return candidates.reduce((a, b) => (b.length > a.length ? b : a))
}

/** Pure: the post title (`og:title`), used as a hint for the recipe name. */
export function extractSocialTitle(html: string): string | null {
  const t = metaContents(html).get('og:title')?.trim()
  return t ? t : null
}

/** Below this, a caption can't hold ingredients + steps; don't spend an LLM call. */
export const MIN_CAPTION_CHARS = 80
const MAX_CAPTION_CHARS = 8_000

// ─── Orchestrator ────────────────────────────────────────────────

export type SocialFetcher = (url: string) => Promise<string>

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

// Same SSRF-safe download as articles: the URL is user-supplied.
const defaultFetchSocial: SocialFetcher = async (url) => {
  const page = await fetchPublicPage(url, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9',
    },
  })
  return page.body
}

export interface SocialExtractDeps {
  provider: TextExtractionProvider
  fetchPage?: SocialFetcher
}

/**
 * Instagram / TikTok link → raw recipe from the caption.
 * Throws `SocialCaptionUnavailableError` whenever the caption doesn't hold a
 * complete recipe (plan B: ask for a screenshot). `UnsafeUrlError` from the
 * SSRF guard propagates untouched.
 */
export async function extractSocialRecipe(
  url: string,
  platform: SocialPlatform,
  deps: SocialExtractDeps,
): Promise<RawExtractedRecipe> {
  const fetcher = deps.fetchPage ?? defaultFetchSocial
  let html: string
  try {
    html = await fetcher(url)
  } catch (err) {
    // Login walls, 4xx/5xx, non-HTML answers: same plan B as an empty caption.
    if (err instanceof PageFetchError) throw new SocialCaptionUnavailableError()
    throw err
  }

  const caption = extractSocialCaption(html)
  if (!caption || caption.length < MIN_CAPTION_CHARS) throw new SocialCaptionUnavailableError()

  const title = extractSocialTitle(html)
  const network = platform === 'instagram' ? 'Instagram' : 'TikTok'
  const text = [`Red social: ${network}`, title ? `Título: ${title}` : null, `Pie del post:\n${caption.slice(0, MAX_CAPTION_CHARS)}`]
    .filter(Boolean)
    .join('\n')

  const llm = await deps.provider.extractRecipeFromText(text, 'social')
  if (!llm.isRecipe) throw new SocialCaptionUnavailableError()
  // A caption with only the ingredients (steps "in the video") or only the
  // steps is not a recipe we can save without inventing the rest.
  if (llm.raw.ingredients.length === 0 || llm.raw.steps.length === 0) {
    throw new SocialCaptionUnavailableError()
  }
  return { ...llm.raw, imageUrl: extractOgImage(html) }
}
