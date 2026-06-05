/**
 * Pure-logic tests for the advisor spend cap. The DB read/gate/record path is
 * exercised against a live server in the smoke script; here we pin the pricing
 * math and usage accumulation — a bug here either lets cost run past the budget
 * or locks users out early.
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_USAGE,
  addAnthropicUsage,
  usageCostUsd,
  usageCostMicros,
  currentMonthKey,
  HAIKU_USD_PER_MTOK,
} from '../services/advisorBudget.js'

describe('addAnthropicUsage', () => {
  it('folds a response usage block, coalescing missing cache fields to 0', () => {
    const u = addAnthropicUsage(EMPTY_USAGE, {
      input_tokens: 1000,
      output_tokens: 200,
      // no cache fields this turn
    })
    expect(u).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    })
  })

  it('accumulates across two calls (tool loop = two model requests)', () => {
    let u = addAnthropicUsage(EMPTY_USAGE, {
      input_tokens: 3000,
      output_tokens: 100,
      cache_creation_input_tokens: 5000,
      cache_read_input_tokens: 0,
    })
    u = addAnthropicUsage(u, {
      input_tokens: 400,
      output_tokens: 300,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 5000,
    })
    expect(u).toEqual({
      inputTokens: 3400,
      outputTokens: 400,
      cacheWriteTokens: 5000,
      cacheReadTokens: 5000,
    })
  })

  it('treats null usage as a no-op', () => {
    expect(addAnthropicUsage(EMPTY_USAGE, null)).toEqual(EMPTY_USAGE)
    expect(addAnthropicUsage(EMPTY_USAGE, undefined)).toEqual(EMPTY_USAGE)
  })
})

describe('usageCostUsd (Haiku 4.5 list price)', () => {
  it('prices each token class at the documented per-MTok rate', () => {
    expect(usageCostUsd({ inputTokens: 1_000_000, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 })).toBeCloseTo(HAIKU_USD_PER_MTOK.input, 6)
    expect(usageCostUsd({ inputTokens: 0, outputTokens: 1_000_000, cacheWriteTokens: 0, cacheReadTokens: 0 })).toBeCloseTo(HAIKU_USD_PER_MTOK.output, 6)
    expect(usageCostUsd({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000, cacheReadTokens: 0 })).toBeCloseTo(HAIKU_USD_PER_MTOK.cacheWrite, 6)
    expect(usageCostUsd({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 1_000_000 })).toBeCloseTo(HAIKU_USD_PER_MTOK.cacheRead, 6)
  })

  it('sums a mixed turn (cache read is ~10x cheaper than fresh input)', () => {
    // 3k fresh input + 5k cache read + 400 output
    const usd = usageCostUsd({ inputTokens: 3000, outputTokens: 400, cacheWriteTokens: 0, cacheReadTokens: 5000 })
    // 3000*1 + 400*5 + 5000*0.1 = 3000 + 2000 + 500 = 5500 micro-USD = $0.0055
    expect(usd).toBeCloseTo(0.0055, 6)
  })
})

describe('usageCostMicros (EUR conversion + integer micro-euros)', () => {
  it('converts USD cost to micro-euros at the given FX rate', () => {
    // 1M output tokens = $5.00; at 0.92 €/$ = €4.60 = 4,600,000 micro-euros
    expect(usageCostMicros({ inputTokens: 0, outputTokens: 1_000_000, cacheWriteTokens: 0, cacheReadTokens: 0 }, 0.92)).toBe(4_600_000)
  })

  it('rounds sub-cent turns to an integer rather than dropping them', () => {
    const micros = usageCostMicros({ inputTokens: 3000, outputTokens: 400, cacheWriteTokens: 0, cacheReadTokens: 5000 }, 0.92)
    // $0.0055 * 0.92 = €0.00506 → 5060 micro-euros
    expect(micros).toBe(5060)
  })

  it('a €5 budget covers on the order of ~1000 typical turns', () => {
    const perTurn = usageCostMicros({ inputTokens: 3000, outputTokens: 400, cacheWriteTokens: 0, cacheReadTokens: 5000 }, 0.92)
    const turns = Math.floor(5_000_000 / perTurn)
    expect(turns).toBeGreaterThan(500)
  })
})

describe('currentMonthKey', () => {
  it('formats as YYYY-MM', () => {
    expect(currentMonthKey(new Date('2026-06-05T12:00:00Z'))).toBe('2026-06')
    expect(currentMonthKey(new Date('2026-01-31T23:59:59Z'))).toBe('2026-01')
  })
})
