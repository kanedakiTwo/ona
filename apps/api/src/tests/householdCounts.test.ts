/**
 * What Mimo notes about the household also sets the account's counts
 * (2026-10-22: a tester's kids were in WhatsApp but her profile said 0
 * niños). The route-level check is householdCounts.smoke.ts.
 */
import { describe, expect, it } from 'vitest'
import { householdCountsPatch, syncHouseholdCounts } from '../services/userMemoryStore.js'

describe('householdCountsPatch', () => {
  it('maps the two household keys to the account columns', () => {
    expect(householdCountsPatch('household.adults', 2)).toEqual({ adults: 2 })
    expect(householdCountsPatch('household.kids_2_to_10', 2)).toEqual({ kidsCount: 2 })
    expect(householdCountsPatch('household.kids_2_to_10', 0)).toEqual({ kidsCount: 0 })
  })

  it('ignores other keys and values the account cannot hold', () => {
    expect(householdCountsPatch('dislikes', ['cilantro'])).toBeNull()
    expect(householdCountsPatch('household.adults', 0)).toBeNull()
    expect(householdCountsPatch('household.kids_2_to_10', 1.5)).toBeNull()
    expect(householdCountsPatch('household.kids_2_to_10', '2')).toBeNull()
  })
})

describe('syncHouseholdCounts', () => {
  function fakeTx() {
    const sets: object[] = []
    const tx = { update: () => ({ set: (patch: object) => ({ where: async () => void sets.push(patch) }) }) }
    return { tx, sets }
  }

  it('one update with both counts when Mimo notes «dos adultos y dos niños»', async () => {
    const { tx, sets } = fakeTx()
    await syncHouseholdCounts(tx, 'u1', [{ key: 'household.adults', value: 2 }, { key: 'household.kids_2_to_10', value: 2 }, { key: 'dislikes', value: ['hígado'] }])
    expect(sets).toEqual([{ adults: 2, kidsCount: 2 }])
  })

  it('no update when nothing is about the household', async () => {
    const { tx, sets } = fakeTx()
    await syncHouseholdCounts(tx, 'u1', [{ key: 'equipment', value: ['horno'] }])
    expect(sets).toEqual([])
  })
})
