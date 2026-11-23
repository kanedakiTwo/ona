/**
 * Speech-to-text chain (2026-10-25): OpenAI's key gave 401 in production and
 * 429 in staging, so voice notes and Mimo's voice went deaf. Now Groq (free
 * Whisper) → OpenAI: the first one configured transcribes, and the next one
 * tries when it fails or hears nothing. AiKit left the chain with PRO-1122:
 * it has no processor contract, so it never gets users' audio, even with its
 * key set (it still makes recipe photos).
 *
 * fetch is simulated: these tests never reach Groq or OpenAI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const recordCost = vi.fn()
vi.mock('../services/costLedger.js', () => ({ recordCost: (...a: unknown[]) => recordCost(...a) }))

import { env } from '../config/env.js'
import { PRICES, computeCostMicros } from '../config/pricing.js'
import {
  GROQ_TRANSCRIBE_URL,
  SttNotConfiguredError,
  groqText,
  groqUnits,
  isSttConfigured,
  sttProviders,
  transcribeAudio,
} from '../services/stt.js'

const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions'
const AUDIO = Buffer.from('OggS fake opus voice note bytes')
const SAID = 'Añade dos kilos de tomates a la lista de la compra.'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
const groqOk = (text = SAID) =>
  jsonResponse(200, { task: 'transcribe', language: 'spanish', duration: 12, text, segments: [{ text, no_speech_prob: 0.01, avg_logprob: -0.2 }] })
const groqSilence = () =>
  jsonResponse(200, { duration: 4, text: ' Subtítulos realizados por la comunidad de Amara.org', segments: [{ no_speech_prob: 0.9, avg_logprob: -1.4 }] })
const openaiOk = (text = SAID) =>
  jsonResponse(200, { text, usage: { type: 'tokens', input_tokens: 120, input_token_details: { audio_tokens: 100, text_tokens: 20 }, output_tokens: 30 } })

const saved = {
  GROQ_API_KEY: env.GROQ_API_KEY,
  GROQ_TRANSCRIBE_MODEL: env.GROQ_TRANSCRIBE_MODEL,
  AIKIT_API_KEY: env.AIKIT_API_KEY,
  OPENAI_API_KEY: env.OPENAI_API_KEY,
  OPENAI_TRANSCRIBE_MODEL: env.OPENAI_TRANSCRIBE_MODEL,
}

let fetchMock: ReturnType<typeof vi.fn>
const urls = () => fetchMock.mock.calls.map((c) => c[0] as string)

beforeEach(() => {
  env.GROQ_API_KEY = 'groq-test-key'
  env.GROQ_TRANSCRIBE_MODEL = 'whisper-large-v3-turbo'
  // Set on purpose: the images use it, and transcription must ignore it.
  env.AIKIT_API_KEY = 'aikit-test-key'
  env.OPENAI_API_KEY = 'openai-test-key'
  env.OPENAI_TRANSCRIBE_MODEL = 'gpt-4o-transcribe'
  recordCost.mockReset()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  Object.assign(env, saved)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AiKit never gets the audio (PRO-1122)', () => {
  it('with AiKit\'s key set, the chain is Groq → OpenAI', () => {
    expect(sttProviders()).toEqual(['groq', 'openai'])
  })

  it('AiKit alone is no transcription at all', async () => {
    env.GROQ_API_KEY = ''
    env.OPENAI_API_KEY = ''
    expect(isSttConfigured()).toBe(false)
    await expect(transcribeAudio(AUDIO, 'audio/ogg')).rejects.toBeInstanceOf(SttNotConfiguredError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Groq and OpenAI both failing never falls to AiKit', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: 'Rate limit reached' } }))
      .mockResolvedValueOnce(jsonResponse(500, { error: { message: 'boom' } }))
    await expect(transcribeAudio(AUDIO, 'audio/ogg')).rejects.toThrow(/OpenAI transcription 500/)
    expect(urls()).toEqual([GROQ_TRANSCRIBE_URL, OPENAI_URL])
    expect(urls().some((u) => u.includes('aikit'))).toBe(false)
  })
})

describe('which providers are in the chain', () => {
  it('Groq → OpenAI, only the configured ones', () => {
    expect(sttProviders({ groq: true, openai: true })).toEqual(['groq', 'openai'])
    expect(sttProviders({ groq: false, openai: true })).toEqual(['openai'])
    expect(sttProviders({ groq: true, openai: false })).toEqual(['groq'])
    expect(sttProviders({ groq: false, openai: false })).toEqual([])
  })

  it('isSttConfigured is true with either of them', () => {
    env.GROQ_API_KEY = ''
    expect(isSttConfigured()).toBe(true) // OpenAI alone
    env.OPENAI_API_KEY = ''
    expect(isSttConfigured()).toBe(false)
    env.GROQ_API_KEY = 'groq-test-key'
    expect(isSttConfigured()).toBe(true)
  })
})

describe('order of the chain', () => {
  it('Groq answers first and OpenAI is not called', async () => {
    fetchMock.mockResolvedValueOnce(groqOk())
    expect(await transcribeAudio(AUDIO, 'audio/ogg; codecs=opus')).toBe(SAID)
    expect(urls()).toEqual([GROQ_TRANSCRIBE_URL])
    expect(recordCost).toHaveBeenCalledWith({
      feature: 'voice_note_transcription',
      provider: 'groq',
      model: 'whisper-large-v3-turbo',
      units: { minutes: 12 / 60 },
    })
  })

  it('Groq fails → OpenAI transcribes, and the ledger says OpenAI', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(openaiOk())
    expect(await transcribeAudio(AUDIO, 'audio/webm', { feature: 'mimo_voice_transcription' })).toBe(SAID)
    expect(urls()).toEqual([GROQ_TRANSCRIBE_URL, OPENAI_URL])
    expect(recordCost).toHaveBeenCalledTimes(1)
    expect(recordCost.mock.calls[0][0]).toMatchObject({ feature: 'mimo_voice_transcription', provider: 'openai', model: 'gpt-4o-transcribe' })
  })

  it('without GROQ_API_KEY the chain starts at OpenAI', async () => {
    env.GROQ_API_KEY = ''
    fetchMock.mockResolvedValueOnce(openaiOk())
    expect(await transcribeAudio(AUDIO, 'audio/ogg')).toBe(SAID)
    expect(urls()).toEqual([OPENAI_URL])
  })

  it('Groq alone failing → its error', async () => {
    env.OPENAI_API_KEY = ''
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: { message: 'Rate limit reached' } }))
    await expect(transcribeAudio(AUDIO, 'audio/ogg')).rejects.toThrow('Groq transcription 429: Rate limit reached')
  })
})

describe('an empty answer moves on to the next provider', () => {
  it('Groq hears only silence → OpenAI tries', async () => {
    fetchMock.mockResolvedValueOnce(groqSilence()).mockResolvedValueOnce(openaiOk())
    expect(await transcribeAudio(AUDIO, 'audio/ogg')).toBe(SAID)
    expect(urls()).toEqual([GROQ_TRANSCRIBE_URL, OPENAI_URL])
  })

  it('all empty → empty text, not an error', async () => {
    fetchMock.mockResolvedValueOnce(groqSilence()).mockResolvedValueOnce(openaiOk(''))
    expect(await transcribeAudio(AUDIO, 'audio/ogg')).toBe('')
  })

  it('Groq hears silence and there is no OpenAI → empty text', async () => {
    env.OPENAI_API_KEY = ''
    fetchMock.mockResolvedValueOnce(groqSilence())
    expect(await transcribeAudio(AUDIO, 'audio/ogg')).toBe('')
    expect(urls()).toEqual([GROQ_TRANSCRIBE_URL])
  })
})

describe('Groq request', () => {
  it('multipart with the file, the model, Spanish, the vocabulary prompt and verbose_json', async () => {
    fetchMock.mockResolvedValueOnce(groqOk())
    await transcribeAudio(AUDIO, 'audio/ogg; codecs=opus')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer groq-test-key')
    const form = init.body as FormData
    expect(form.get('model')).toBe('whisper-large-v3-turbo')
    expect(form.get('language')).toBe('es')
    expect(form.get('response_format')).toBe('verbose_json')
    expect(String(form.get('prompt'))).toMatch(/Mimo/)
    const file = form.get('file') as File
    expect(file.name).toBe('nota-de-voz.ogg')
    expect(file.type).toBe('audio/ogg')
    expect(Buffer.from(await file.arrayBuffer())).toEqual(AUDIO)
  })

  it('GROQ_TRANSCRIBE_MODEL changes the model, and the ledger follows', async () => {
    env.GROQ_TRANSCRIBE_MODEL = 'whisper-large-v3'
    fetchMock.mockResolvedValueOnce(groqOk())
    await transcribeAudio(AUDIO, 'audio/webm;codecs=opus')
    const form = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData
    expect(form.get('model')).toBe('whisper-large-v3')
    expect((form.get('file') as File).name).toBe('nota-de-voz.webm')
    expect(recordCost.mock.calls[0][0]).toMatchObject({ provider: 'groq', model: 'whisper-large-v3' })
  })
})

describe('pure helpers', () => {
  it('groqUnits: the duration in minutes, 10 s at least (what Groq bills)', () => {
    expect(groqUnits({ duration: 90 })).toEqual({ minutes: 1.5 })
    expect(groqUnits({ duration: 3 })).toEqual({ minutes: 10 / 60 })
    expect(groqUnits({})).toEqual({ minutes: 10 / 60 })
  })

  it('groqText drops a transcript whose every segment is silence by Whisper\'s rule', () => {
    expect(groqText({ text: 'Hola', segments: [{ no_speech_prob: 0.1, avg_logprob: -0.3 }] })).toBe('Hola')
    expect(groqText({ text: 'Gracias.', segments: [{ no_speech_prob: 0.8, avg_logprob: -1.2 }] })).toBe('')
    // High no-speech probability but a confident decode is kept (Whisper's rule needs both).
    expect(groqText({ text: 'Sí.', segments: [{ no_speech_prob: 0.8, avg_logprob: -0.4 }] })).toBe('Sí.')
    expect(groqText({ text: 'Sin segmentos' })).toBe('Sin segmentos')
  })
})

describe('prices of the new providers', () => {
  const FX = { eurPerUsd: 0.9, table: PRICES }
  it('Groq whisper-large-v3-turbo: $0.04 an hour', () => {
    // 60 min × $0.04/60 = $0.04 → €0.036
    expect(computeCostMicros('groq', 'whisper-large-v3-turbo', { minutes: 60 }, FX)).toBe(36_000)
    // A 10 s minimum note: $0.04 / 360 ≈ $0.000111 → €0.0001
    expect(computeCostMicros('groq', 'whisper-large-v3-turbo', groqUnits({ duration: 4 }), FX)).toBe(100)
  })
})
