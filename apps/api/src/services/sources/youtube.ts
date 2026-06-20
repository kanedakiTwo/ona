/**
 * YouTube source extractor: turns a YouTube URL into the text payload that
 * the LLM consumes (title + description + transcript), then asks the LLM
 * for the structured recipe.
 *
 * The pure helpers (`parseYouTubeVideoId`, `buildYouTubePromptInput`) are
 * exported so they can be unit-tested without touching the network or the
 * LLM.
 */

import type {
  RawExtractedRecipe,
  TextExtractionProvider,
} from '../recipeExtractor.js'

/** Minimum length we accept for a description-only payload (no transcript). */
const MIN_USEFUL_DESCRIPTION_CHARS = 200

/**
 * Thrown when a YouTube video has neither captions nor a description long
 * enough to look like it might contain a recipe. The route handler maps this
 * to a 422 with a friendly Spanish message.
 */
export class NoExtractableContentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoExtractableContentError'
  }
}

/**
 * Pull the 11-char video id from any of the URL shapes YouTube exposes:
 *   - youtube.com/watch?v=<id>
 *   - youtu.be/<id>
 *   - m.youtube.com/watch?v=<id>
 *   - youtube.com/shorts/<id>
 * Returns null for malformed URLs or non-YouTube hosts.
 */
export function parseYouTubeVideoId(input: string): string | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\//, '').split('/')[0]
    return id.length > 0 ? id : null
  }
  if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    const v = url.searchParams.get('v')
    if (v) return v
    const shortsMatch = url.pathname.match(/^\/shorts\/([^/]+)/)
    if (shortsMatch) return shortsMatch[1]
  }
  return null
}

export interface YouTubeMeta {
  title: string
  description: string
}

/**
 * Parse `title` + `shortDescription` out of a YouTube watch-page HTML body.
 *
 * Needed as a fallback because Innertube (youtubei.js) often gets rate-limited
 * or returns empty `basic_info` when called from a datacenter IP (Railway,
 * Fly, AWS) — the plain watch page is served to anyone and embeds the same
 * data inside a `ytInitialPlayerResponse` JSON blob.
 *
 * Forgiving regexes (vs. JSON.parse over the whole payload) on purpose:
 *   - The blob is multi-MB and contains scripts that confuse balanced-bracket
 *     parsers.
 *   - We only need two fields; pinpointing them is faster and more resilient
 *     to YouTube's monthly HTML shuffles.
 *
 * Returns empty strings (not null) when a field is missing so the caller can
 * still build a payload from whichever signal is available.
 */
export function parseWatchPageMeta(html: string): YouTubeMeta {
  // Match the literal "title":"..." pair INSIDE the videoDetails object. We
  // anchor on `"videoId"` (always present in videoDetails) followed by the
  // sibling `"title"` to avoid picking up unrelated `"title"` strings that
  // appear elsewhere in the page (related-videos, etc.).
  let title = ''
  const titleMatch = html.match(
    /"videoDetails"\s*:\s*\{[^}]*?"title"\s*:\s*"((?:[^"\\]|\\.)*)"/,
  )
  if (titleMatch) {
    title = unescapeJsonString(titleMatch[1])
  } else {
    // Fallback to the <title> tag and strip the " - YouTube" suffix YouTube
    // appends to every watch page.
    const tagMatch = html.match(/<title>([^<]+)<\/title>/i)
    if (tagMatch) {
      title = tagMatch[1].replace(/\s+-\s+YouTube\s*$/i, '').trim()
    }
  }

  let description = ''
  const descMatch = html.match(/"shortDescription"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (descMatch) {
    description = unescapeJsonString(descMatch[1])
  }

  return { title, description }
}

/** JSON-string unescape — handles \n, \t, \", \\ and \uXXXX. */
function unescapeJsonString(s: string): string {
  try {
    return JSON.parse('"' + s + '"') as string
  } catch {
    // Defensive: malformed escape sequence in the captured slice. Fall back
    // to a minimal manual unescape so the user gets *something* useful.
    return s
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
}

export interface YouTubePromptInput {
  title: string
  description: string
  transcript: string | null
}

/**
 * Compose the text payload sent to the LLM. We label each section so the
 * model can prefer cantidades stated explicitly in the description over
 * those it has to infer from the transcript. Throws when neither the
 * transcript nor the description carries enough signal.
 */
export function buildYouTubePromptInput(input: YouTubePromptInput): string {
  const transcript = input.transcript?.trim() ?? ''
  const description = input.description?.trim() ?? ''

  if (transcript.length === 0 && description.length < MIN_USEFUL_DESCRIPTION_CHARS) {
    throw new NoExtractableContentError(
      'Este vídeo no tiene subtítulos disponibles ni una descripción con la receta.',
    )
  }

  const parts: string[] = [`Title:\n${input.title.trim()}`]
  if (description.length > 0) parts.push(`Description:\n${description}`)
  if (transcript.length > 0) parts.push(`Transcript:\n${transcript}`)
  return parts.join('\n\n')
}

// ─── Network fetchers ────────────────────────────────────────────

export type FetchYouTubeMeta = (videoId: string) => Promise<YouTubeMeta>
export type FetchYouTubeTranscript = (videoId: string) => Promise<string | null>

export interface YouTubeFetchers {
  fetchMeta?: FetchYouTubeMeta
  fetchTranscript?: FetchYouTubeTranscript
}

/**
 * Fetch + parse the public watch page directly. Used as a fallback when
 * Innertube returns empty / throws (most often because the production IP
 * is being rate-limited by YouTube's internal API).
 */
async function fetchMetaFromWatchPage(videoId: string): Promise<YouTubeMeta> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    },
    redirect: 'follow',
  })
  if (!res.ok) {
    throw new Error(`watch page returned HTTP ${res.status}`)
  }
  const html = await res.text()
  return parseWatchPageMeta(html)
}

const defaultFetchMeta: FetchYouTubeMeta = async (videoId) => {
  // Primary path: Innertube. Works on dev machines, sometimes works on
  // datacenter IPs. Wrapped in try/catch so a failure here cleanly degrades
  // to the HTML scraper instead of propagating up and 500ing the request.
  let primary: YouTubeMeta | null = null
  try {
    const { Innertube } = await import('youtubei.js')
    const yt = await Innertube.create({ retrieve_player: false })
    const info = await yt.getBasicInfo(videoId)
    primary = {
      title: info.basic_info.title ?? '',
      description: info.basic_info.short_description ?? '',
    }
  } catch {
    primary = null
  }

  // If Innertube gave us a usable description (long enough to plausibly
  // contain a recipe), trust it — that's what tests and the local dev box
  // exercise every day.
  if (primary && primary.description.length >= MIN_USEFUL_DESCRIPTION_CHARS) {
    return primary
  }

  // Otherwise, fall back to scraping the public watch page. This works from
  // Railway/Fly even when the InnerTube /youtubei/v1 endpoints are blocked,
  // because the watch page is served to any browser-shaped User-Agent.
  try {
    const fallback = await fetchMetaFromWatchPage(videoId)
    // Prefer whichever produced a non-empty title, and prefer the LONGER
    // description (one of the two paths sometimes returns a truncated
    // snippet vs the full multi-paragraph blurb).
    return {
      title: fallback.title || primary?.title || '',
      description:
        (fallback.description.length >= (primary?.description.length ?? 0)
          ? fallback.description
          : primary?.description) || '',
    }
  } catch {
    // Watch-page fetch failed too. Return whatever Innertube gave us (even
    // if short) so the prompt builder gets a chance to either accept it
    // alongside a transcript or throw NoExtractableContentError with the
    // user-facing Spanish hint.
    return primary ?? { title: '', description: '' }
  }
}

const defaultFetchTranscript: FetchYouTubeTranscript = async (videoId) => {
  try {
    const { YoutubeTranscript } = await import('youtube-transcript')
    let segments: { text: string }[]
    try {
      segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'es' })
    } catch {
      segments = await YoutubeTranscript.fetchTranscript(videoId)
    }
    if (!segments || segments.length === 0) return null
    return segments
      .map((s) => s.text.trim())
      .filter((t) => t.length > 0)
      .join(' ')
  } catch (err) {
    // Captions disabled / no transcript / network error: treat as null so the
    // payload composer can decide whether the description alone is enough.
    return null
  }
}

// ─── Top-level extractor ─────────────────────────────────────────

export type YouTubeExtractionResult =
  | { isRecipe: true; raw: RawExtractedRecipe }
  | { isRecipe: false; reason: string }

export interface YouTubeExtractDeps {
  provider: TextExtractionProvider
  fetchers?: YouTubeFetchers
}

export async function extractYouTubeRecipe(
  url: string,
  deps: YouTubeExtractDeps,
): Promise<YouTubeExtractionResult> {
  const videoId = parseYouTubeVideoId(url)
  if (!videoId) {
    throw new Error('No se pudo identificar el ID del vídeo de YouTube.')
  }

  const fetchMeta = deps.fetchers?.fetchMeta ?? defaultFetchMeta
  const fetchTranscript =
    deps.fetchers?.fetchTranscript ?? defaultFetchTranscript

  const [meta, transcript] = await Promise.all([
    fetchMeta(videoId),
    fetchTranscript(videoId),
  ])

  // Throws NoExtractableContentError if both transcript missing and description trivial.
  const payload = buildYouTubePromptInput({
    title: meta.title,
    description: meta.description,
    transcript,
  })

  // YouTube thumbnail: `hqdefault.jpg` is guaranteed to exist for every
  // video (480×360). We don't use `maxresdefault.jpg` because it's only
  // generated for ≥720p uploads and 404s on older videos.
  const imageUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

  const llm = await deps.provider.extractRecipeFromText(payload, 'youtube')
  if (!llm.isRecipe) return llm
  return { isRecipe: true, raw: { ...llm.raw, imageUrl } }
}
