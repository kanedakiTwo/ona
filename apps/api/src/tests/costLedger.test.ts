/**
 * Cost ledger recording (services/costLedger.ts): who a paid call is billed to
 * and that recording can never break the user path. The DB insert itself is a
 * one-statement sink swapped for a fake here; the attribution rules are the
 * load-bearing part (a wrong user skews cost per household).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  anthropicUnits,
  attributeCostToUser,
  currentCostChannel,
  currentCostUserId,
  madridMonthStartUtc,
  recordAnthropicCost,
  recordCost,
  runWithCostUser,
  setCostSinkForTests,
  type CostRow,
} from '../services/costLedger.js'

afterEach(() => setCostSinkForTests(null))

function captureSink(): CostRow[] {
  const rows: CostRow[] = []
  setCostSinkForTests(async (row) => {
    rows.push(row)
  })
  return rows
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('cost attribution context', () => {
  it('carries the request user across awaits', async () => {
    await runWithCostUser('u1', async () => {
      await tick()
      expect(currentCostUserId()).toBe('u1')
    })
    expect(currentCostUserId()).toBeNull()
  })

  it('attributeCostToUser fills the user once identity is known (WhatsApp turn)', async () => {
    await runWithCostUser(null, async () => {
      expect(currentCostUserId()).toBeNull()
      attributeCostToUser('u2')
      await tick()
      expect(currentCostUserId()).toBe('u2')
    })
  })

  it('carries the channel so WhatsApp spend can be told apart from the web chat', async () => {
    await runWithCostUser(null, async () => {
      await tick()
      expect(currentCostChannel()).toBe('whatsapp')
    }, 'whatsapp')
    await runWithCostUser('u1', async () => {
      expect(currentCostChannel()).toBe('web')
    })
    expect(currentCostChannel()).toBeNull()
  })

  it('attributeCostToUser outside any context is a no-op', () => {
    attributeCostToUser('u3')
    expect(currentCostUserId()).toBeNull()
  })

  it('concurrent turns do not leak users into each other', async () => {
    const seen: Array<string | null> = []
    await Promise.all([
      runWithCostUser(null, async () => {
        attributeCostToUser('a')
        await tick()
        seen.push(currentCostUserId())
      }),
      runWithCostUser(null, async () => {
        await tick()
        seen.push(currentCostUserId())
      }),
    ])
    expect(seen.sort()).toEqual([null, 'a'].sort())
  })
})

describe('recordCost', () => {
  it('bills the ambient user when no explicit userId is given', async () => {
    const rows = captureSink()
    await runWithCostUser('u1', async () => {
      recordCost({ feature: 'recipe_extract_url', provider: 'anthropic', model: 'claude-sonnet-4-6', units: { inputTokens: 1000 } })
    })
    await tick()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: 'u1', feature: 'recipe_extract_url', provider: 'anthropic', model: 'claude-sonnet-4-6' })
    expect(rows[0].costMicros).toBeGreaterThan(0)
  })

  it('explicit null = system job even inside a user context', async () => {
    const rows = captureSink()
    await runWithCostUser('u1', async () => {
      recordCost({ feature: 'whatsapp_review', provider: 'anthropic', model: 'claude-opus-5-5', units: { inputTokens: 10 }, userId: null })
    })
    await tick()
    expect(rows[0].userId).toBeNull()
  })

  it('unknown model is recorded with costMicros null (flagged as unpriced, not dropped)', async () => {
    const rows = captureSink()
    recordCost({ feature: 'x', provider: 'anthropic', model: 'claude-nope', units: { inputTokens: 10 } })
    await tick()
    expect(rows[0].costMicros).toBeNull()
  })

  it('a failing sink never throws into the caller', async () => {
    setCostSinkForTests(async () => {
      throw new Error('db down')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => recordCost({ feature: 'x', provider: 'openai', model: 'gpt-realtime', units: { minutes: 1 } })).not.toThrow()
    await tick()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('anthropicUnits / recordAnthropicCost', () => {
  it('maps the SDK usage block (snake_case, optional cache fields) to ledger units', () => {
    expect(
      anthropicUnits({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: null, cache_read_input_tokens: 7 }),
    ).toEqual({ inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 7 })
  })

  it('missing usage records nothing', async () => {
    const rows = captureSink()
    recordAnthropicCost('unit_fallback', 'claude-haiku-4-5-20251001', undefined)
    await tick()
    expect(rows).toHaveLength(0)
  })
})

describe('madridMonthStartUtc (monthly spend window)', () => {
  it('is 00:00 Europe/Madrid on the 1st, DST-aware', () => {
    // Summer (CEST, UTC+2)
    expect(madridMonthStartUtc(new Date('2026-07-15T10:00:00Z')).toISOString()).toBe('2026-06-30T22:00:00.000Z')
    // Winter (CET, UTC+1)
    expect(madridMonthStartUtc(new Date('2026-12-15T10:00:00Z')).toISOString()).toBe('2026-11-30T23:00:00.000Z')
  })

  it('uses the Madrid calendar: 23:30 UTC on Oct 31 is already November in Madrid', () => {
    expect(madridMonthStartUtc(new Date('2026-10-31T23:30:00Z')).toISOString()).toBe('2026-10-31T23:00:00.000Z')
  })
})
