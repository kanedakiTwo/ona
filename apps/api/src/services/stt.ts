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
 *   2. AiKit (`AIKIT_API_KEY` + `AIKIT_TRANSCRIBE_MODEL`): Gemini through
 *      AiKit's chat API. Reserve only: given background noise and no voice,
 *      it writes a plausible sentence nobody said (measured 2026-10-25).
 *   3. OpenAI (`OPENAI_API_KEY`): `OPENAI_TRANSCRIBE_MODEL`.
 *
 * Plain fetch + FormData — no SDK for three calls. The cost ledger row of each
 * call says which provider and model transcribed.
 */

export type SttProvider = 'groq' | 'aikit' | 'openai'

export class SttNotConfiguredError extends Error {
  constructor() {
    super('No speech-to-text provider configured (GROQ_API_KEY / AIKIT_API_KEY / OPENAI_API_KEY)')
    this.name = 'SttNotConfiguredError'
  }
}

/** Providers to try, in order: the configured ones of Groq → AiKit → OpenAI. */
export function sttProviders(
  keys: Record<SttProvider, boolean> = {
    groq: Boolean(env.GROQ_API_KEY),
    aikit: Boolean(env.AIKIT_API_KEY && env.AIKIT_TRANSCRIBE_MODEL),
    openai: Boolean(env.OPENAI_API_KEY),
  },
): SttProvider[] {
  return (['groq', 'aikit', 'openai'] as const).filter((p) => keys[p])
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
  aikit: transcribeWithAikit,
  openai: transcribeWithOpenAI,
}

export async function transcribeAudio(audio: Buffer, mimeType: string, opts: { feature?: string } = {}): Promise<string> {
  const providers = sttProviders()
  if (providers.length === 0) throw new SttNotConfiguredError()
  const feature = opts.feature ?? 'voice_note_transcription'
  let lastErr: unknown = null
  let heardNothing = false
  for (const p of providers) {
    // A real speech recogniser already heard no voice: AiKit's Gemini would
    // invent a sentence for that same silence, so it is not asked.
    if (p === 'aikit' && heardNothing) continue
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

// ─── AiKit ───────────────────────────────────────────────────────

export const AIKIT_CHAT_URL = 'https://cms.aikit.es/api/inference/chat/completions'
/** What AiKit's model is told to answer when there is no voice. */
export const AIKIT_NO_SPEECH = '[SIN_VOZ]'
/** Larger notes skip AiKit: the base64 data URI grows a third and Gemini takes ~20 MB per request. */
export const AIKIT_MAX_AUDIO_BYTES = 10 * 1024 * 1024

export const AIKIT_TRANSCRIBE_INSTRUCTIONS =
  'Eres un sistema de transcripción automática (ASR). Escribe exactamente las palabras que se oyen en el audio adjunto, en español de España, sin resumir, sin corregir, sin traducir y sin añadir nada; nunca inventes ni completes palabras que no se oigan con claridad. Devuelve solo la transcripción, sin comillas ni comentarios. ' +
  `Si no se oye ninguna voz humana (silencio, ruido de fondo, música), responde exactamente: ${AIKIT_NO_SPEECH}. ` +
  'Contexto, solo para reconocer mejor las palabras: son notas de voz para Mimo, el asistente de cocina de Mimoia (menú de la semana, recetas, comida, cena, lista de la compra, despensa, días de la semana).'

/**
 * Pure: the MIME type written in the data URI. AiKit takes ogg/opus, webm,
 * mp4/aac, mp3, wav and flac as they come (tried on 2026-10-25); aliases are
 * written the standard way.
 */
export function aikitAudioMime(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase()
  const alias: Record<string, string> = {
    'audio/opus': 'audio/ogg',
    'audio/mp3': 'audio/mpeg',
    'audio/m4a': 'audio/mp4',
    'audio/x-m4a': 'audio/mp4',
    'audio/x-wav': 'audio/wav',
  }
  return alias[base] ?? (base || 'audio/ogg')
}

/** Pure: the model's answer → transcript ('' for the no-voice marker). */
export function aikitText(content: unknown): string {
  if (typeof content !== 'string') return ''
  const text = content.trim().replace(/^["«“](.*)["»”]$/s, '$1').trim()
  return text.split(AIKIT_NO_SPEECH).join('').trim()
}

async function transcribeWithAikit(audio: Buffer, mimeType: string, feature: string): Promise<string> {
  if (audio.length > AIKIT_MAX_AUDIO_BYTES) throw new Error(`AiKit transcription: audio over ${AIKIT_MAX_AUDIO_BYTES} bytes`)
  // The audio goes as an `image_url` part with a data URI: AiKit answers 400
  // to `input_audio` and `file` parts.
  const body = JSON.stringify({
    model: env.AIKIT_TRANSCRIBE_MODEL,
    temperature: 0,
    messages: [
      { role: 'system', content: AIKIT_TRANSCRIBE_INSTRUCTIONS },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${aikitAudioMime(mimeType)};base64,${audio.toString('base64')}` } }] },
    ],
  })
  // Now and then AiKit answers 200 with no text, or a cut-off one, and 0
  // tokens used: that answer is not trusted, and asked once more.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await fetch(AIKIT_CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AIKIT_API_KEY}`, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(30_000),
    })
    const json: any = await r.json().catch(() => ({}))
    if (!r.ok) {
      const detail = json?.errors?.[0]?.message ?? json?.error?.message ?? 'unknown error'
      throw new Error(`AiKit transcription ${r.status}: ${detail}`)
    }
    const usage = json?.usage ?? {}
    const inputTokens = Number(usage.prompt_tokens) || 0
    const outputTokens = Number(usage.completion_tokens) || 0
    if (outputTokens > 0) {
      recordCost({ feature, provider: 'aikit', model: json.model || env.AIKIT_TRANSCRIBE_MODEL, units: { inputTokens, outputTokens } })
      return aikitText(json?.choices?.[0]?.message?.content)
    }
    console.warn(`[stt] aikit answered without a transcription (try ${attempt})`)
  }
  throw new Error('AiKit transcription: empty answer')
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
