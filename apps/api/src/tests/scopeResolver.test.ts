/**
 * Pure-logic tests for the scope resolver. The resolver picks between
 * legacy `user_id` filtering and new `household_id` filtering based on
 * the SHARED_HOUSEHOLD_SCOPE env flag.
 *
 * Why pure-function tests instead of integration: the branching logic is
 * the load-bearing piece (an env-flag bug here would either leak rows
 * cross-household or hide rows from a user's own household). The DB
 * round-trip is exercised by the smoke script.
 */
import { describe, expect, it } from 'vitest'
import { pickScope, type Scope } from '../services/scopeResolver.js'

describe('pickScope', () => {
  it('returns user-scope when flag is OFF', () => {
    const scope: Scope = pickScope({
      userId: 'u1',
      householdId: 'h1',
      flagOn: false,
    })
    expect(scope.kind).toBe('user')
    expect(scope.value).toBe('u1')
  })

  it('returns household-scope when flag is ON and household exists', () => {
    const scope: Scope = pickScope({
      userId: 'u1',
      householdId: 'h1',
      flagOn: true,
    })
    expect(scope.kind).toBe('household')
    expect(scope.value).toBe('h1')
  })

  it('falls back to user-scope when flag is ON but household is missing', () => {
    // Defensive: if a user somehow lacks a primary_household_id (data drift,
    // pre-0011 row that the backfill missed) we must not crash — we read
    // by their user_id, which still works because dual-write keeps that
    // column populated.
    const scope: Scope = pickScope({
      userId: 'u1',
      householdId: null,
      flagOn: true,
    })
    expect(scope.kind).toBe('user')
    expect(scope.value).toBe('u1')
  })
})
