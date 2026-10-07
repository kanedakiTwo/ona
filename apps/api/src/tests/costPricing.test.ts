/**
 * Price table → euros for the cost ledger (config/pricing.ts). A bug here
 * silently skews the cost-per-household number Finance prices against, so we
 * pin the per-unit math for every provider kind, the FX conversion, the
 * model-id normalisation and the env override.
 */
import { describe, expect, it } from 'vitest'
import {
  PRICES,
  computeCostMicros,
  normalizeModel,
  parsePriceOverrides,
  priceFor,
} from '../config/pricing.js'
import { ASSISTANT_MODEL } from '../services/assistant/engine.js'
import { REVIEW_MODEL } from '../services/whatsapp/reviewer.js'
import { transcriptionUnits } from '../services/stt.js'
import { ADVISOR_PRICE_MODEL, HAIKU_USD_PER_MTOK } from '../services/advisorBudget.js'

const FX = { eurPerUsd: 0.9, table: PRICES }

describe('normalizeModel', () => {
  it('drops dated snapshot suffixes so ids match the price table', () => {
    expect(normalizeModel('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5')
    expect(normalizeModel('gpt-realtime-2025-08-28')).toBe('gpt-realtime')
    expect(normalizeModel('claude-opus-5-5')).toBe('claude-opus-5-5')
  })
})

describe('computeCostMicros', () => {
  it('prices Anthropic token classes per MTok and converts USD → EUR', () => {
    // Haiku 4.5: 1M in ($1) + 1M out ($5) + 1M cache write ($1.25) + 1M cache read ($0.10) = $7.35 → €6.615
    const micros = computeCostMicros(
      'anthropic',
      'claude-haiku-4-5-20251001',
      { inputTokens: 1e6, outputTokens: 1e6, cacheWriteTokens: 1e6, cacheReadTokens: 1e6 },
      FX,
    )
    expect(micros).toBe(6_615_000)
  })

  it('prices Opus 5.5 at $4 / $20 with the 0.05× cache-read rate', () => {
    expect(computeCostMicros('anthropic', 'claude-opus-5-5', { inputTokens: 1e6 }, FX)).toBe(3_600_000)
    expect(computeCostMicros('anthropic', 'claude-opus-5-5', { outputTokens: 1e6 }, FX)).toBe(18_000_000)
    expect(computeCostMicros('anthropic', 'claude-opus-5-5', { cacheReadTokens: 1e6 }, FX)).toBe(180_000)
  })

  it('prices per-minute audio (realtime voice) and per-token transcription', () => {
    const perMin = PRICES['openai/gpt-realtime'].perMinute!
    expect(computeCostMicros('openai', 'gpt-realtime', { minutes: 10 }, FX)).toBe(Math.round(10 * perMin * 0.9 * 1e6))
    // gpt-4o-transcribe: 1000 audio tokens ($2.50/MTok) + 100 output tokens ($10/MTok) = $0.0035 → €0.00315
    expect(computeCostMicros('openai', 'gpt-4o-transcribe', { audioInputTokens: 1000, outputTokens: 100 }, FX)).toBe(3150)
    // Duration-billed usage (whisper-style `{ type: 'duration' }`) falls back to the per-minute estimate.
    expect(computeCostMicros('openai', 'gpt-4o-transcribe', { minutes: 1 }, FX)).toBe(5400)
  })

  it('EUR-denominated prices (WhatsApp templates) are not FX-converted', () => {
    expect(computeCostMicros('meta_whatsapp', 'utility_template', { messages: 2 }, FX)).toBe(33_200)
  })

  it('prices images per unit', () => {
    const perImage = PRICES['aikit/imagen-fal'].perImage!
    expect(computeCostMicros('aikit', 'imagen-fal', { images: 1 }, FX)).toBe(Math.round(perImage * 0.9 * 1e6))
  })

  it('returns null for an unknown model so the ledger can flag it as unpriced', () => {
    expect(computeCostMicros('anthropic', 'claude-unknown-9', { inputTokens: 1000 }, FX)).toBeNull()
  })

  it('zero units cost zero', () => {
    expect(computeCostMicros('anthropic', 'claude-sonnet-4-6', {}, FX)).toBe(0)
  })
})

describe('price table coverage', () => {
  it('every model the API calls is priced (changing a model without pricing it fails here)', () => {
    for (const [provider, model] of [
      ['anthropic', ASSISTANT_MODEL],
      ['anthropic', REVIEW_MODEL],
      ['anthropic', 'claude-sonnet-5-5'], // recipe extraction + ingredient matcher
      ['anthropic', 'claude-opus-4-6'], // ingredient nutrition estimate
      ['anthropic', 'claude-haiku-4-5-20251001'], // unit fallback + USDA translator
      ['openai', 'gpt-realtime'],
      ['openai', 'gpt-4o-transcribe'],
      ['meta_whatsapp', 'utility_template'],
      ['aikit', 'imagen-fal'],
    ] as const) {
      expect(priceFor(provider, model), `${provider}/${model}`).toBeTruthy()
    }
  })

  it('the advisor budget prices the assistant model from the same table', () => {
    expect(normalizeModel(ASSISTANT_MODEL)).toBe(ADVISOR_PRICE_MODEL)
    const p = priceFor('anthropic', ASSISTANT_MODEL)!
    expect(HAIKU_USD_PER_MTOK).toEqual({
      input: p.inputPerMTok,
      output: p.outputPerMTok,
      cacheWrite: p.cacheWritePerMTok,
      cacheRead: p.cacheReadPerMTok,
    })
  })
})

describe('parsePriceOverrides (COST_PRICE_OVERRIDES)', () => {
  it('merges numeric fields over the base entry', () => {
    const table = parsePriceOverrides('{"openai/gpt-realtime":{"perMinute":0.2}}', PRICES)
    expect(table['openai/gpt-realtime'].perMinute).toBe(0.2)
    expect(table['openai/gpt-realtime'].currency).toBe('USD')
    expect(table['anthropic/claude-haiku-4-5']).toEqual(PRICES['anthropic/claude-haiku-4-5'])
  })

  it('can add a new model', () => {
    const table = parsePriceOverrides('{"openai/gpt-realtime-mini":{"currency":"USD","perMinute":0.03}}', PRICES)
    expect(table['openai/gpt-realtime-mini']).toEqual({ currency: 'USD', perMinute: 0.03 })
  })

  it('ignores malformed JSON and non-numeric values instead of crashing boot', () => {
    expect(parsePriceOverrides('{not json', PRICES)).toEqual(PRICES)
    const t = parsePriceOverrides('{"openai/gpt-realtime":{"perMinute":"cheap"}}', PRICES)
    expect(t['openai/gpt-realtime'].perMinute).toBe(PRICES['openai/gpt-realtime'].perMinute)
  })

  it('empty string → base table', () => {
    expect(parsePriceOverrides('', PRICES)).toBe(PRICES)
  })
})

describe('transcriptionUnits (OpenAI usage → ledger units)', () => {
  it('token-billed models: audio vs text input, text output', () => {
    expect(
      transcriptionUnits({ type: 'tokens', input_tokens: 120, input_token_details: { audio_tokens: 100, text_tokens: 20 }, output_tokens: 30, total_tokens: 150 }),
    ).toEqual({ audioInputTokens: 100, inputTokens: 20, outputTokens: 30 })
  })

  it('duration-billed models (whisper-1): seconds → minutes', () => {
    expect(transcriptionUnits({ type: 'duration', seconds: 90 })).toEqual({ minutes: 1.5 })
  })

  it('missing usage → empty units (recorded at zero cost rather than dropped)', () => {
    expect(transcriptionUnits(undefined)).toEqual({})
  })
})
