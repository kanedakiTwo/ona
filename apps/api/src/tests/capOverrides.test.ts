/**
 * Per-person caps (Miguel, 2026-11-23): a creator who uses Mimo a lot gets her
 * own monthly cap (20 €) on both Mimo and all paid AI; everyone else keeps the
 * general caps.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {}, pool: {} }))

import { env } from '../config/env.js'
import { capOverrideEur, parseCapOverrides } from '../services/capOverrides.js'
import { budgetMicros } from '../services/advisorBudget.js'
import { spendCapStatus } from '../services/spendCap.js'

const VERO = '0f5c7d0a-0103-4f65-b262-903a3930c83d'
const OTRA = '11111111-2222-3333-4444-555555555555'
const original = env.USER_CAP_OVERRIDES_EUR

afterEach(() => { env.USER_CAP_OVERRIDES_EUR = original })

describe('parseCapOverrides', () => {
  it('reads id:euros pairs and skips malformed ones', () => {
    const m = parseCapOverrides(` ${VERO}:20 , nope:5, ${OTRA}:abc, ${OTRA}:-1,`)
    expect([...m.entries()]).toEqual([[VERO, 20]])
  })

  it('is case-insensitive on the id', () => {
    expect(capOverrideEur(VERO.toUpperCase(), `${VERO}:20`)).toBe(20)
    expect(capOverrideEur(OTRA, `${VERO}:20`)).toBeUndefined()
    expect(capOverrideEur(undefined, `${VERO}:20`)).toBeUndefined()
  })
})

describe('both caps follow the override', () => {
  it("Mimo's budget: her own, others the general one", () => {
    env.USER_CAP_OVERRIDES_EUR = `${VERO}:20`
    expect(budgetMicros(VERO)).toBe(20_000_000)
    expect(budgetMicros(OTRA)).toBe(Math.round(env.ADVISOR_MONTHLY_BUDGET_EUR * 1_000_000))
    expect(budgetMicros()).toBe(Math.round(env.ADVISOR_MONTHLY_BUDGET_EUR * 1_000_000))
  })

  it('all paid AI: 12 € spent is under her 20 € but over a 10 € general cap', async () => {
    env.USER_CAP_OVERRIDES_EUR = `${VERO}:20`
    const spent = async () => 12
    const general = env.USER_MONTHLY_SPEND_CAP_EUR
    env.USER_MONTHLY_SPEND_CAP_EUR = 10
    try {
      expect(await spendCapStatus(VERO, { spent })).toMatchObject({ exceeded: false, capEur: 20 })
      expect(await spendCapStatus(OTRA, { spent })).toMatchObject({ exceeded: true, capEur: 10 })
    } finally { env.USER_MONTHLY_SPEND_CAP_EUR = general }
  })
})
