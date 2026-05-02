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

const defaultFetchMeta: FetchYouTubeMeta = async (videoId) => {
  const { Innertube } = await import('youtubei.js')
  const yt = await Innertube.create({ retrieve_player: false })
  const info = await yt.getBasicInfo(videoId)
  return {
    title: info.basic_info.title ?? '',
    description: info.basic_info.short_description ?? '',
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

  return await deps.provider.extractRecipeFromText(payload, 'youtube')
}
