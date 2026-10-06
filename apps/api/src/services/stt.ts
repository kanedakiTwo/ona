import { env } from '../config/env.js'

/**
 * Speech-to-text for WhatsApp voice notes via OpenAI's transcription API
 * (OPENAI_API_KEY is already set for the Realtime voice mode). Plain fetch +
 * FormData — the project has no OpenAI SDK and doesn't need one for one call.
 */

export class SttNotConfiguredError extends Error {
  constructor() {
    super('OPENAI_API_KEY is not configured')
    this.name = 'SttNotConfiguredError'
  }
}

export function isSttConfigured(): boolean {
  return Boolean(env.OPENAI_API_KEY)
}

/**
 * OpenAI infers the container from the file name, so map WhatsApp's MIME
 * types (voice notes are `audio/ogg; codecs=opus`) to a matching extension.
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
    'audio/aac': 'm4a',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
  }
  return `nota-de-voz.${ext[base] ?? 'ogg'}`
}

export const TRANSCRIBE_PROMPT =
  'Nota de voz en español de España para ONA, un asistente de cocina: menú de la semana, recetas, comida, cena, lista de la compra, despensa, lunes, martes, miércoles, jueves, viernes, sábado, domingo.'

export async function transcribeAudio(audio: Buffer, mimeType: string): Promise<string> {
  if (!env.OPENAI_API_KEY) throw new SttNotConfiguredError()
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
  return typeof json.text === 'string' ? json.text : ''
}
