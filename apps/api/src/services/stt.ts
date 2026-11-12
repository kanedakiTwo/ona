import { env } from '../config/env.js'
import type { CostUnits } from '../config/pricing.js'
import { recordCost } from './costLedger.js'

/**
 * Speech-to-text: WhatsApp voice notes, Mimo's voice in the app (`POST /stt`)
 * and the voice onboarding. A chain of providers (2026-10-25): the first one
 * configured transcribes; when it fails or hears nothing, the next one tries.
 *
 *   1. Groq (`GROQ_API_KEY`): Whisper (`GROQ_TRANSCRIBE_MODEL`) through its
 *      OpenAI-compatible API. Free plan; accepts flac, mp3, mp4, mpeg, mpga,
 *      m4a, ogg, wav and webm up to 25 MB.
 *   2. OpenAI (`OPENAI_API_KEY`): `OPENAI_TRANSCRIBE_MODEL`.
 *
 * Never AiKit (PRO-1122): it has no processor contract with Mimoia, so it
 * must not receive users' audio (it still makes recipe photos from text).
 *
 * Plain fetch + FormData — no SDK for two calls. The cost ledger row of each
 * call says which provider and model transcribed.
 */

export type SttProvider = 'groq' | 'openai'

export class SttNotConfiguredError extends Error {
  constructor() {
    super('No speech-to-text provider configured (GROQ_API_KEY / OPENAI_API_KEY)')
    this.name = 'SttNotConfiguredError'
  }
}

/** Providers to try, in order: the configured ones of Groq → OpenAI. */
export function sttProviders(
  keys: Record<SttProvider, boolean> = {
    groq: Boolean(env.GROQ_API_KEY),
    openai: Boolean(env.OPENAI_API_KEY),
  },
): SttProvider[] {
  return (['groq', 'openai'] as const).filter((p) => keys[p])
}

export function isSttConfigured(): boolean {
  return sttProviders().length > 0
}

/**
 * Groq and OpenAI infer the container from the file name, so map WhatsApp's
 * MIME types (voice notes are `audio/ogg; codecs=opus`) and the browser's
 * (MediaRecorder: webm/opus, or mp4 on Safari) to a matching extension.
 */
export function audioFileName(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase()
  const ext: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/opus': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'm4a',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
    'audio/flac': 'flac',
  }
  return `nota-de-voz.${ext[base] ?? 'ogg'}`
}

export const TRANSCRIBE_PROMPT =
  'Nota de voz en español de España para Mimo, el asistente de cocina de Mimoia: menú de la semana, recetas, comida, cena, lista de la compra, despensa, lunes, martes, miércoles, jueves, viernes, sábado, domingo.'

const TRANSCRIBERS: Record<SttProvider, (audio: Buffer, mimeType: string, feature: string) => Promise<string>> = {
  groq: transcribeWithGroq,
  openai: transcribeWithOpenAI,
}

export async function transcribeAudio(audio: Buffer, mimeType: string, opts: { feature?: string } = {}): Promise<string> {
  const providers = sttProviders()
  if (providers.length === 0) throw new SttNotConfiguredError()
  const feature = opts.feature ?? 'voice_note_transcription'
  let lastErr: unknown = null
  let heardNothing = false
  for (const p of providers) {
    try {
      const text = (await TRANSCRIBERS[p](audio, mimeType, feature)).trim()
      if (text) return text
      heardNothing = true
      console.warn(`[stt] ${p} heard nothing`)
    } catch (err) {
      lastErr = err
      console.warn(`[stt] ${p} failed:`, (err as Error)?.message ?? err)
    }
  }
  if (heardNothing || !lastErr) return ''
  throw lastErr
}

// ─── Groq ────────────────────────────────────────────────────────

export const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
/** Groq bills every request for at least 10 s of audio. */
const GROQ_MIN_BILLED_SECONDS = 10

async function transcribeWithGroq(audio: Buffer, mimeType: string, feature: string): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType.split(';')[0] }), audioFileName(mimeType))
  form.append('model', env.GROQ_TRANSCRIBE_MODEL)
  form.append('language', 'es')
  form.append('prompt', TRANSCRIBE_PROMPT)
  // verbose_json brings the duration (what Groq bills) and per-segment silence scores.
  form.append('response_format', 'verbose_json')
  form.append('temperature', '0')
  const r = await fetch(GROQ_TRANSCRIBE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  const json: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Groq transcription ${r.status}: ${json?.error?.message ?? 'unknown error'}`)
  recordCost({ feature, provider: 'groq', model: env.GROQ_TRANSCRIBE_MODEL, units: groqUnits(json) })
  return groqText(json)
}

/** Pure: Groq's verbose_json → ledger units (its duration, 10 s at least). */
export function groqUnits(json: any): CostUnits {
  const seconds = Number(json?.duration)
  return { minutes: Math.max(Number.isFinite(seconds) ? seconds : 0, GROQ_MIN_BILLED_SECONDS) / 60 }
}

/**
 * Pure: the text of Groq's verbose_json, or '' when every segment is silence
 * by Whisper's own rule (no_speech_prob > 0.6 and avg_logprob < -1): what
 * Whisper writes over silence is made up («Subtítulos realizados por…»).
 */
export function groqText(json: any): string {
  const segments: any[] = Array.isArray(json?.segments) ? json.segments : []
  const silent = (s: any) => Number(s?.no_speech_prob) > 0.6 && Number(s?.avg_logprob) < -1
  if (segments.length > 0 && segments.every(silent)) return ''
  return typeof json?.text === 'string' ? json.text : ''
}

// ─── OpenAI ──────────────────────────────────────────────────────

async function transcribeWithOpenAI(audio: Buffer, mimeType: string, feature: string): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType.split(';')[0] }), audioFileName(mimeType))
  form.append('model', env.OPENAI_TRANSCRIBE_MODEL)
  form.append('language', 'es')
  // Steers vocabulary and language: without it short Spanish notes were
  // occasionally transcribed as Galician/Portuguese ("está ben", "ademais").
  form.append('prompt', TRANSCRIBE_PROMPT)
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  const json: any = await r.json().catch(() => ({}))
  if (!r.ok) {
    throw new Error(`OpenAI transcription ${r.status}: ${json?.error?.message ?? 'unknown error'}`)
  }
  // Billed to the user of the current turn (cost-ledger context).
  recordCost({
    feature,
    provider: 'openai',
    model: env.OPENAI_TRANSCRIBE_MODEL,
    units: transcriptionUnits(json?.usage),
  })
  return typeof json.text === 'string' ? json.text : ''
}

/**
 * Pure: the transcription response's `usage` → ledger units. gpt-4o-*
 * models report tokens (`{ type: 'tokens', input_token_details: { audio_tokens,
 * text_tokens }, output_tokens }`); whisper-1 reports `{ type: 'duration', seconds }`.
 */
export function transcriptionUnits(usage: any): CostUnits {
  if (usage?.type === 'duration' && Number.isFinite(usage.seconds)) return { minutes: usage.seconds / 60 }
  if (usage?.type === 'tokens') {
    const details = usage.input_token_details ?? {}
    const audio = Number(details.audio_tokens ?? usage.input_tokens ?? 0)
    const text = Number(details.text_tokens ?? 0)
    return { audioInputTokens: audio, inputTokens: text, outputTokens: Number(usage.output_tokens ?? 0) }
  }
  return {}
}
