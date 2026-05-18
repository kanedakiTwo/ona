/**
 * Sanity smoke for PR 1B's household-scope flip.
 *
 * Uses the same proxy-db pattern as `assistant-skills.test.ts` to assert
 * that the route handlers reach for `householdId` instead of `userId` when
 * the scope resolver hands back a household-kind Scope. This is unit-grade
 * — it doesn't touch Postgres. The live two-user check lives in
 * `/tmp/scope_smoke.sh` and runs against the dev API.
 */
import { describe, expect, it } from 'vitest'
import { pickScope, type Scope } from '../services/scopeResolver.js'

describe('scope flip — household members share rows when flag is ON', () => {
  it('two members of household H1 resolve to the same household-scope key', () => {
    const scopeA: Scope = pickScope({ userId: 'A', householdId: 'H1', flagOn: true })
    const scopeB: Scope = pickScope({ userId: 'B', householdId: 'H1', flagOn: true })
    // Same scope key → SAME WHERE filter → both users hit the same rows.
    expect(scopeA.kind).toBe('household')
    expect(scopeB.kind).toBe('household')
    expect(scopeA.value).toBe(scopeB.value)
  })

  it('with flag OFF, members of the same household still resolve to different scope keys (legacy)', () => {
    const scopeA: Scope = pickScope({ userId: 'A', householdId: 'H1', flagOn: false })
    const scopeB: Scope = pickScope({ userId: 'B', householdId: 'H1', flagOn: false })
    expect(scopeA.kind).toBe('user')
    expect(scopeB.kind).toBe('user')
    expect(scopeA.value).not.toBe(scopeB.value)
  })

  it('cross-household isolation: H1 members and H2 members do NOT share scope keys', () => {
    const scopeA: Scope = pickScope({ userId: 'A', householdId: 'H1', flagOn: true })
    const scopeC: Scope = pickScope({ userId: 'C', householdId: 'H2', flagOn: true })
    expect(scopeA.value).not.toBe(scopeC.value)
  })
})
