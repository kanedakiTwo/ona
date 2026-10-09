/**
 * Chat read-aloud with ElevenLabs (services/tts.ts): voice list parsing,
 * what gets said, and the upstream call + cost.
 */
import { describe, it, expect, vi } from 'vitest'
import { parseVoices, speakableText, spokenUnits, synthesize, MAX_TTS_CHARS, TtsError } from '../services/tts.js'
import { computeCostMicros } from '../config/pricing.js'
import { setCostSinkForTests } from '../services/costLedger.js'

describe('parseVoices', () => {
  it('reads "Name:id" pairs in order, first = default, with URL-safe keys', () => {
    expect(parseVoices('Sara Martín:KHCvMklQZZo0O30ERnVn, Carolina:UOIqAnmS11Reiei1Ytkc')).toEqual([
      { key: 'sara-martin', name: 'Sara Martín', id: 'KHCvMklQZZo0O30ERnVn' },
      { key: 'carolina', name: 'Carolina', id: 'UOIqAnmS11Reiei1Ytkc' },
    ])
  })
  it('skips malformed entries and duplicates', () => {
    expect(parseVoices('nada, :abc, Sara:bad id!, Sara:KHCvMklQZZo0O30ERnVn, Sara:UOIqAnmS11Reiei1Ytkc')).toHaveLength(1)
    expect(parseVoices('')).toEqual([])
  })
})

describe('speakableText', () => {
  it('says the words, not the Markdown, links or emoji', () => {
    const md = 'Vale, **vamos** a crear tu receta 🍳. Necesito:\n\n1. Nombre de la receta\n- Ingredientes con `cantidades`\n\n[Ver receta](https://mimoia.com/recipes/1) https://x.y/z'
    expect(speakableText(md)).toBe('Vale, vamos a crear tu receta. Necesito:\nNombre de la receta\nIngredientes con cantidades\nVer receta')
  })
  it('cuts long replies at a sentence end', () => {
    const long = 'Una frase corta. '.repeat(200)
    const out = speakableText(long)
    expect(out.length).toBeLessThanOrEqual(MAX_TTS_CHARS)
    expect(out.endsWith('.')).toBe(true)
  })
})

describe('synthesize', () => {
  const voice = { key: 'sara', name: 'Sara', id: 'KHCvMklQZZo0O30ERnVn' }

  it('streams from ElevenLabs with the voice, Spanish and the model, and records the characters', async () => {
    const events: any[] = []
    setCostSinkForTests((e: any) => events.push(e))
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }))
    const body = await synthesize('Hola, soy Mimo.', voice, { fetch: fetchMock as any })
    expect(body).toBeTruthy()
    const [url, init] = fetchMock.mock.calls[0] as any
    expect(url).toContain('/v1/text-to-speech/KHCvMklQZZo0O30ERnVn/stream')
    expect(JSON.parse(init.body)).toMatchObject({ text: 'Hola, soy Mimo.', language_code: 'es' })
    expect(events[0]).toMatchObject({ feature: 'chat_tts', provider: 'elevenlabs', units: { chars: 15 } })
    setCostSinkForTests(null)
  })

  it('throws a TtsError with the upstream status (e.g. 402: library voice on a free plan)', async () => {
    const fetchMock = vi.fn(async () => new Response('{"detail":"paid_plan_required"}', { status: 402 }))
    await expect(synthesize('Hola', voice, { fetch: fetchMock as any })).rejects.toBeInstanceOf(TtsError)
  })
})

describe('pricing', () => {
  it('prices TTS per 1,000 characters', () => {
    expect(computeCostMicros('elevenlabs', 'eleven_multilingual_v2', { chars: 1000 }, { eurPerUsd: 1, table: { 'elevenlabs/eleven_multilingual_v2': { currency: 'USD', perKChars: 0.2 } } })).toBe(200_000)
  })
})

describe('spokenUnits (abbreviations read in full)', () => {
  it.each([
    ['Hornea 10 min a 180 °C.', 'Hornea 10 minutos a 180 grados.'],
    ['Deja reposar 1 min.', 'Deja reposar 1 minuto.'],
    ['Cuece 10-15 min.', 'Cuece de 10 a 15 minutos.'],
    ['Añade 200 g de arroz y 1 kg de patatas.', 'Añade 200 gramos de arroz y 1 kilo de patatas.'],
    ['Pon 250 ml de leche y 1,5 l de agua.', 'Pon 250 mililitros de leche y 1,5 litros de agua.'],
    ['2 cdas de aceite y 1 cdita de sal.', '2 cucharadas de aceite y 1 cucharadita de sal.'],
    ['1 cda de miel.', '1 cucharada de miel.'],
    ['3 uds de huevo.', '3 unidades de huevo.'],
    ['Tarda 1 h y 20 min.', 'Tarda 1 hora y 20 minutos.'],
    ['Unas 450 kcal por ración.', 'Unas 450 kilocalorías por ración.'],
    ['Cuesta 4,99 €.', 'Cuesta 4,99 euros.'],
    ['Aprox. 30 min.', 'Aproximadamente 30 minutos.'],
    ['Sin gluten, p. ej. con arroz.', 'Sin gluten, por ejemplo con arroz.'],
    ['El 20 % de la grasa.', 'El 20 por ciento de la grasa.'],
    ['Unos 7 u 8 min.', 'Unos 7 u 8 minutos.'],
    ['Ya lleva 20 minutos y 1 hora.', 'Ya lleva 20 minutos y 1 hora.'],
  ])('%s', (input, expected) => {
    expect(spokenUnits(input)).toBe(expected)
  })

  it('leaves words that only look like units alone', () => {
    expect(spokenUnits('Mínimo g de gracia, hola Mimo')).toBe('Mínimo g de gracia, hola Mimo')
  })

  it('is applied by speakableText', () => {
    expect(speakableText('**Hornea** 25 min')).toBe('Hornea 25 minutos')
  })
})
