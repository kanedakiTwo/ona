/**
 * PRO-53: every free-form WhatsApp message Mimo sends (a "service" message,
 * inside the 24 h window) is written to the cost ledger. Since 2026-10-01 Meta
 * gives each business number 1,000 free service messages a month and bills
 * €0.0166 (Spain) from the 1,001st. The row is always written; it costs 0
 * inside the free tier.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { computeCostMicros, PRICES } from '../config/pricing.js'
import { setCostSinkForTests, type CostRow } from '../services/costLedger.js'
import {
  SERVICE_FEATURE,
  SERVICE_FREE_TIER_PER_MONTH,
  SERVICE_MODEL,
  recordServiceMessageCost,
  serviceMessageUnits,
} from '../services/whatsapp/serviceCost.js'

afterEach(() => setCostSinkForTests(null))

const opts = { eurPerUsd: 0.9, table: PRICES }

describe('serviceMessageUnits — Meta free tier', () => {
  it('the 1,000 first messages of the month are free', () => {
    expect(SERVICE_FREE_TIER_PER_MONTH).toBe(1000)
    for (const before of [0, 1, 500, 999]) {
      const units = serviceMessageUnits(before)
      expect(computeCostMicros('meta_whatsapp', SERVICE_MODEL, units, opts)).toBe(0)
      expect(units.freeMessages).toBe(1)
    }
  })

  it('the 1,001st and later cost €0.0166 each', () => {
    for (const before of [1000, 1001, 5000]) {
      const units = serviceMessageUnits(before)
      expect(units.messages).toBe(1)
      expect(computeCostMicros('meta_whatsapp', SERVICE_MODEL, units, opts)).toBe(16_600)
    }
  })
})

describe('recordServiceMessageCost', () => {
  function capture(): CostRow[] {
    const rows: CostRow[] = []
    setCostSinkForTests(async (row) => {
      rows.push(row)
    })
    return rows
  }

  it('always writes the row: free inside the tier', async () => {
    const rows = capture()
    await recordServiceMessageCost('u1', { countThisMonth: async () => 12 })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: 'u1', feature: SERVICE_FEATURE, provider: 'meta_whatsapp', model: SERVICE_MODEL, costMicros: 0 })
  })

  it('priced past the tier, and a user-less send (unlinked number) is still recorded', async () => {
    const rows = capture()
    await recordServiceMessageCost(null, { countThisMonth: async () => 1000 })
    expect(rows[0]).toMatchObject({ userId: null, costMicros: 16_600 })
  })

  it('never throws: if the count fails the row is still written, priced (better to overestimate a cost)', async () => {
    const rows = capture()
    await expect(
      recordServiceMessageCost('u1', {
        countThisMonth: async () => {
          throw new Error('db down')
        },
      }),
    ).resolves.toBeUndefined()
    expect(rows).toHaveLength(1)
    expect(rows[0].costMicros).toBe(16_600)
  })
})
