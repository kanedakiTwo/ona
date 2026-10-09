/**
 * Read-aloud for the chat (the speaker button and auto-read replies) with
 * ElevenLabs, instead of the browser's built-in voice, which sounds robotic
 * (Miguel, 2026-10-09). Off when ELEVENLABS_API_KEY or ELEVENLABS_VOICES is
 * empty: the web then keeps the browser voice. specs/advisor.md → Voice.
 *
 * Not the realtime "Modo voz" (OpenAI Realtime, routes/realtime.ts).
 */

import { env } from '../config/env.js'
import { recordCost } from './costLedger.js'

export interface TtsVoice {
  /** Stable key the web sends back (slug of the name). */
  key: string
  name: string
  id: string
}

/** Longest text read in one go; longer replies are cut at a sentence end. */
export const MAX_TTS_CHARS = 1200

/** Pure: "Sara:abc123, Carolina:def456" → voices (first = default). Bad entries are skipped. */
export function parseVoices(raw: string): TtsVoice[] {
  const out: TtsVoice[] = []
  for (const part of raw.split(',')) {
    const [name, id] = part.split(':').map((x) => x?.trim())
    if (!name || !id || !/^[A-Za-z0-9]{8,64}$/.test(id)) continue
    const key = name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    if (key && !out.some((v) => v.key === key)) out.push({ key, name, id })
  }
  return out
}

/**
 * Pure: chat Markdown → what should be said. Drops links' URLs, code, list
 * markers, emphasis and emoji; keeps the words. Cuts at MAX_TTS_CHARS on a
 * sentence boundary when it can.
 */
export function speakableText(md: string): string {
  let t = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, '$2')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([.,;:!?])/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim()
  if (t.length > MAX_TTS_CHARS) {
    const cut = t.slice(0, MAX_TTS_CHARS)
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
    t = end > MAX_TTS_CHARS * 0.5 ? cut.slice(0, end + 1) : cut
  }
  return t
}

export function ttsVoices(): TtsVoice[] {
  return env.ELEVENLABS_API_KEY ? parseVoices(env.ELEVENLABS_VOICES) : []
}

export class TtsError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'TtsError'
  }
}

/**
 * Stream MP3 from ElevenLabs. Returns the upstream body for the route to
 * pipe; records the character cost (billed to the request's user).
 */
export async function synthesize(
  text: string,
  voice: TtsVoice,
  deps: { fetch?: typeof fetch } = {},
): Promise<ReadableStream<Uint8Array>> {
  const f = deps.fetch ?? fetch
  const res = await f(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice.id}/stream?output_format=mp3_44100_64`,
    {
      method: 'POST',
      headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: env.ELEVENLABS_MODEL,
        language_code: 'es',
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
      }),
    },
  )
  if (!res.ok || !res.body) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 300)
    } catch {}
    throw new TtsError(res.status, `ElevenLabs ${res.status}: ${detail}`)
  }
  recordCost({ feature: 'chat_tts', provider: 'elevenlabs', model: env.ELEVENLABS_MODEL, units: { chars: text.length } })
  return res.body as ReadableStream<Uint8Array>
}
