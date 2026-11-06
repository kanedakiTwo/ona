/**
 * Speech-to-text chain (2026-10-25): OpenAI's key gave 401 in production and
 * 429 in staging, so voice notes and Mimo's voice went deaf. Now Groq (free
 * Whisper) → AiKit (Gemini through its chat API) → OpenAI: the first one
 * configured transcribes, and the next one tries when it fails or hears
 * nothing. AiKit is skipped after a real recogniser heard no voice, because
 * Gemini invents a sentence for background noise.
 *
 * fetch is simulated: these tests never reach Groq, AiKit or OpenAI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const recordCost = vi.fn()
vi.mock('../services/costLedger.js', () => ({ recordCost: (...a: unknown[]) => recordCost(...a) }))

import { env } from '../config/env.js'
import { PRICES, computeCostMicros } from '../config/pricing.js'
import {
  AIKIT_CHAT_URL,
  AIKIT_NO_SPEECH,
  GROQ_TRANSCRIBE_URL,
  SttNotConfiguredError,
  aikitAudioMime,
  aikitText,
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
const aikitOk = (content: string | null = SAID, usage = { prompt_tokens: 392, completion_tokens: 207, total_tokens: 599 }) =>
  jsonResponse(200, { model: 'google/gemini-3.8-flash', choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage, cost: 0.000956 })
const aikitBlank = () => aikitOk(null, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })
const openaiOk = (text = SAID) =>
  jsonResponse(200, { text, usage: { type: 'tokens', input_tokens: 120, input_token_details: { audio_tokens: 100, text_tokens: 20 }, output_tokens: 30 } })

const saved = {
  GROQ_API_KEY: env.GROQ_API_KEY,
  GROQ_TRANSCRIBE_MODEL: env.GROQ_TRANSCRIBE_MODEL,
  AIKIT_API_KEY: env.AIKIT_API_KEY,
  AIKIT_TRANSCRIBE_MODEL: env.AIKIT_TRANSCRIBE_MODEL,
  OPENAI_API_KEY: env.OPENAI_API_KEY,
  OPENAI_TRANSCRIBE_MODEL: env.OPENAI_TRANSCRIBE_MODEL,
}

let fetchMock: ReturnType<typeof vi.fn>
const urls = () => fetchMock.mock.calls.map((c) => c[0] as string)

beforeEach(() => {
  env.GROQ_API_KEY = 'groq-test-key'
  env.GROQ_TRANSCRIBE_MODEL = 'whisper-large-v3-turbo'
  env.AIKIT_API_KEY = 'aikit-test-key'
  env.AIKIT_TRANSCRIBE_MODEL = 'google/gemini-3.8-flash'
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

describe('which providers are in the chain', () => {
  it('Groq → AiKit → OpenAI, only the configured ones', () => {
    expect(sttProviders({ groq: true, aikit: true, openai: true })).toEqual(['groq', 'aikit', 'openai'])
    expect(sttProviders({ groq: false, aikit: true, openai: true })).toEqual(['aikit', 'openai'])
    expect(sttProviders({ groq: true, aikit: false, openai: false })).toEqual(['groq'])
    expect(sttProviders({ groq: false, aikit: false, openai: false })).toEqual([])
  })

  it('reads the keys from env; an empty AIKIT_TRANSCRIBE_MODEL takes AiKit out', () => {
    expect(sttProviders()).toEqual(['groq', 'aikit', 'openai'])
    env.AIKIT_TRANSCRIBE_MODEL = ''
    expect(sttProviders()).toEqual(['groq', 'openai'])
  })

  it('isSttConfigured is true with any one of them', () => {
    env.GROQ_API_KEY = ''
    env.OPENAI_API_KEY = ''
    expect(isSttConfigured()).toBe(true) // AiKit alone
    env.AIKIT_API_KEY = ''
    expect(isSttConfigured()).toBe(false)
    env.GROQ_API_KEY = 'groq-test-key'
    expect(isSttConfigured()).toBe(true)
  })

  it('none configured → SttNotConfiguredError (the route answers 503, WhatsApp says it cannot listen)', async () => {
    env.GROQ_API_KEY = ''
    env.AIKIT_API_KEY = ''
    env.OPENAI_API_KEY = ''
    await expect(transcribeAudio(AUDIO, 'audio/ogg')).rejects.toBeInstanceOf(SttNotConfiguredError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('order of the chain', () => {
  it('Groq answers first and the others are not called', async () => {
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

  it('Groq fails → AiKit transcribes, and the ledger says AiKit', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: { message: 'Rate limit reached' } })).mockResolvedValueOnce(aikitOk())
    expect(await transcribeAudio(AUDIO, 'audio/ogg', { feature: 'mimo_voice_transcription' })).toBe(SAID)
    expect(urls()).toEqual([GROQ_TRANSCRIBE_URL, AIKIT_CHAT_URL])
    expect(recordCost).toHaveBeenCalledTimes(1)
    expect(recordCost).toHaveBeenCalledWith({
      feature: 'mimo_voice_transcription',
      provider: 'aikit',
      model: 'google/gemini-3.8-flash',
      units: { inputTokens: 392, outputTokens: 207 },
    })
  })

  it('Groq and AiKit fail → OpenAI', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse(500, { errors: [{ message: 'boom' }] }))
      .mockResolvedValueOnce(openaiOk())
    expect(await transcribeAudio(AUDIO, 'audio/webm')).toBe(SAID)
    expect(urls()).toEqual([GROQ_TRANSCRIBE_URL, AIKIT_CHAT_URL, OPENAI_URL])
    expect(recordCost.mock.calls[0][0]).toMatchObject({ provider: 'openai', model: 'gpt-4o-transcribe' })
  })

  it('every provider fails → the last error (the route answers 502, WhatsApp asks to repeat)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { message: 'Invalid API Key' } }))
      .mockResolvedValueOnce(jsonResponse(403, { errors: [{ message: 'no' }] }))
      .mockResolvedValueOnce(jsonResponse(401, { error: { message: 'invalid_api_key' } }))
    await expect(transcribeAudio(AUDIO, 'audio/ogg')).rejects.toThrow(/OpenAI transcription 401/)
  })
})

describe('only the configured providers are called', () => {
  it('without GROQ_API_KEY the chain starts at AiKit', async () => {
    env.GROQ_API_KEY = ''
    fetchMock.mockResolvedValueOnce(aikitOk())
    expect(await transcribeAudio(AUDIO, 'audio/ogg')).toBe(SAID)
    expect(urls()).toEqual([AIKIT_CHAT_URL])
  })

  it('without AiKit, a Groq failure goes straight to OpenAI', async () => {
    env.AIKIT_API_KEY = ''
    fetchMock.mockResolvedValueOnce(jsonResponse(503, {})).mockResolvedValueOnce(openaiOk())
    expect(await transcribeAudio(AUDIO, 'audio/ogg')).toBe(SAID)
    expect(urls()).toEqual([GROQ_TRANSCRIBE_URL, OPENAI_URL])
  })

  it('Groq alone failing → its error', async () => {
    env.AIKIT_API_KEY = ''
    env.OPENAI_API_KEY = ''
    fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: { message: 'Rate limit reached' } }))
    await expect(transcribeAudio(AUDIO, 'audio/ogg')).rejects.toThrow('Groq transcription 429: Rate limit reached')
  })
})

describe('an empty answer moves on to the next provider', () => {
  it('Groq hears only silence → OpenAI tries; AiKit is skipped (it would invent a sentence)', async () => {
    fetchMock.mockResolvedValueOnce(groqSilence()).mockResolvedValueOnce(openaiOk())
    expect(await transcribeAudio(AUDIO, 'audio/ogg')).toBe(SAID)
    expect(urls()).toEqual([GROQ_TRANSCRIBE_URL, OPENAI_URL])
  })

  it('Groq hears silence and there is no OpenAI → empty text, AiKit not asked', async () => {
    env.OPENAI_API_KEY = ''
    fetchMock.mockResolvedValueOnce(groqSilence())
    expect(await transcribeAudio(AUDIO, 'audio/ogg')).toBe('')
    expect(urls()).toEqual([GROQ_TRANSCRIBE_URL])
  })

  it('AiKit says there is no voice → OpenAI tries; all empty → empty text, not an error', async () => {
    env.GROQ_API_KEY = ''
    fetchMock.mockResolvedValueOnce(aikitOk(AIKIT_NO_SPEECH)).mockResolvedValueOnce(openaiOk(''))
    expect(await transcribeAudio(AUDIO, 'audio/ogg')).toBe('')
    expect(urls()).toEqual([AIKIT_CHAT_URL, OPENAI_URL])
  })

  it('AiKit answering with no text and 0 tokens is asked once more, and not billed', async () => {
    env.GROQ_API_KEY = ''
    fetchMock.mockResolvedValueOnce(aikitBlank()).mockResolvedValueOnce(aikitOk())
    expect(await transcribeAudio(AUDIO, 'audio/ogg')).toBe(SAID)
    expect(urls()).toEqual([AIKIT_CHAT_URL, AIKIT_CHAT_URL])
    expect(recordCost).toHaveBeenCalledTimes(1)
  })

  it('a cut-off AiKit text with 0 tokens is not trusted; twice → OpenAI', async () => {
    env.GROQ_API_KEY = ''
    const cutOff = aikitOk('Hola Mimo, añade 2 kg de tomates a la lista de la', { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 })
    fetchMock.mockResolvedValueOnce(cutOff).mockResolvedValueOnce(aikitBlank()).mockResolvedValueOnce(openaiOk())
    expect(await transcribeAudio(AUDIO, 'audio/ogg')).toBe(SAID)
    expect(urls()).toEqual([AIKIT_CHAT_URL, AIKIT_CHAT_URL, OPENAI_URL])
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

describe('AiKit request', () => {
  it('chat completion with the audio as an image_url data URI, temperature 0, literal-transcription instructions', async () => {
    env.GROQ_API_KEY = ''
    fetchMock.mockResolvedValueOnce(aikitOk())
    await transcribeAudio(AUDIO, 'audio/ogg; codecs=opus')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://cms.aikit.es/api/inference/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer aikit-test-key')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('google/gemini-3.8-flash')
    expect(body.temperature).toBe(0)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toMatch(/exactamente las palabras que se oyen/)
    expect(body.messages[0].content).toContain(AIKIT_NO_SPEECH)
    const part = body.messages[1].content[0]
    expect(part.type).toBe('image_url')
    expect(part.image_url.url).toBe(`data:audio/ogg;base64,${AUDIO.toString('base64')}`)
  })

  it('a note over 10 MB skips AiKit', async () => {
    env.GROQ_API_KEY = ''
    fetchMock.mockResolvedValueOnce(openaiOk())
    expect(await transcribeAudio(Buffer.alloc(10 * 1024 * 1024 + 1), 'audio/ogg')).toBe(SAID)
    expect(urls()).toEqual([OPENAI_URL])
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

  it('aikitText: the marker for no voice is empty; quotes around the text go', () => {
    expect(aikitText(AIKIT_NO_SPEECH)).toBe('')
    expect(aikitText(` ${AIKIT_NO_SPEECH}\n`)).toBe('')
    expect(aikitText('«Hola, Mimo.»')).toBe('Hola, Mimo.')
    expect(aikitText(null)).toBe('')
  })

  it('aikitAudioMime writes aliases the standard way and drops codec parameters', () => {
    expect(aikitAudioMime('audio/ogg; codecs=opus')).toBe('audio/ogg')
    expect(aikitAudioMime('audio/webm;codecs=opus')).toBe('audio/webm')
    expect(aikitAudioMime('audio/mp4')).toBe('audio/mp4')
    expect(aikitAudioMime('audio/x-m4a')).toBe('audio/mp4')
    expect(aikitAudioMime('audio/mp3')).toBe('audio/mpeg')
    expect(aikitAudioMime('audio/opus')).toBe('audio/ogg')
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

  it('AiKit Gemini 3.8 Flash: what AiKit reported for a 10 s note', () => {
    // 392 in × 0.67 + 207 out × 3.35 per MTok ≈ 0.000956 (AiKit's `cost`)
    expect(computeCostMicros('aikit', 'google/gemini-3.8-flash', { inputTokens: 392, outputTokens: 207 }, FX)).toBe(956)
  })
})
