/**
 * PRO-1203 · «Quién come»: how the people of the house count for the
 * shopping list and the menu, and the allergies of the people without an
 * account. Pure functions; the database side is `quienCome.smoke.ts`.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {}, pool: {} }))

import { householdMultiplier } from '@ona/shared'
import {
  cleanList,
  countGroups,
  countsAfterChange,
  groupOfAgeBand,
  groupOfRole,
  storedCounts,
  undescribed,
} from '../services/householdPeople.js'
import { personRestrictionsInForce, unionMemberRestrictions } from '../services/householdAllergies.js'
import { mergeRestrictions } from '../services/dietaryRestrictions.js'

describe('how each person counts', () => {
  it('adults from 11 (13–17 and adults), children 2–10 (3–5 and 6–12), babies not at all', () => {
    expect(['adulto', '13-17', '6-12', '3-5', '0-2', null].map(groupOfAgeBand)).toEqual(['adult', 'adult', 'kid', 'kid', 'none', 'none'])
    expect(['owner', 'member', 'child'].map(groupOfRole)).toEqual(['adult', 'adult', 'kid'])
    expect(countGroups(['adult', 'kid', 'none', 'adult'])).toEqual({ adults: 2, kidsCount: 1 })
  })
})

describe('the size of the house (what the shopping list scales by)', () => {
  it('reads the account like the shopping list does, the old enum for a very old account', () => {
    expect(storedCounts({ adults: 3, kidsCount: 1, householdSize: 'solo' })).toEqual({ adults: 3, kidsCount: 1 })
    expect(storedCounts({ adults: 0, kidsCount: 0, householdSize: 'family_with_kids' })).toEqual({ adults: 2, kidsCount: 2 })
    expect(storedCounts(null)).toEqual({ adults: 2, kidsCount: 0 })
  })

  it('a house already filled in keeps exactly the multiplier it had', () => {
    // Owner + partner (accounts) + «la pequeña» 3–5; the counter said 2 + 1.
    const stored = { adults: 2, kidsCount: 1 }
    const listed = countGroups(['adult', 'adult', 'kid'])
    expect(undescribed(stored, listed)).toEqual({ adults: 0, kidsCount: 0 })
    expect(countsAfterChange(stored, listed, {})).toEqual(stored)
    const before = householdMultiplier(stored.adults, stored.kidsCount)
    const after = countsAfterChange(stored, listed, {})
    expect(householdMultiplier(after.adults, after.kidsCount)).toBe(before)
  })

  it('a house that only has the old counter keeps it, with rows nobody describes yet', () => {
    const stored = { adults: 2, kidsCount: 1 }
    const onlyMe = countGroups(['adult'])
    expect(undescribed(stored, onlyMe)).toEqual({ adults: 1, kidsCount: 1 })
    expect(countsAfterChange(stored, onlyMe, {})).toEqual(stored)
  })

  it('describing someone takes the place of an undescribed row; adding more raises it', () => {
    const stored = { adults: 2, kidsCount: 1 }
    // «la pequeña» (3–5) is the child the counter had.
    expect(countsAfterChange(stored, countGroups(['adult', 'kid']), { added: 'kid' })).toEqual({ adults: 2, kidsCount: 1 })
    // A second child is new.
    expect(countsAfterChange(stored, countGroups(['adult', 'kid', 'kid']), { added: 'kid' })).toEqual({ adults: 2, kidsCount: 2 })
    // A baby doesn't count.
    expect(countsAfterChange(stored, countGroups(['adult', 'kid', 'none']), { added: 'none' })).toEqual(stored)
  })

  it('removing someone lowers their group by one, never below the people listed nor below one adult', () => {
    expect(countsAfterChange({ adults: 3, kidsCount: 1 }, countGroups(['adult', 'adult', 'kid']), { removed: 'adult' })).toEqual({ adults: 2, kidsCount: 1 })
    expect(countsAfterChange({ adults: 1, kidsCount: 0 }, countGroups([]), { removed: 'adult' })).toEqual({ adults: 1, kidsCount: 0 })
    // «No está» on «Un niño»: the counter goes down even with no one listed.
    expect(countsAfterChange({ adults: 2, kidsCount: 2 }, countGroups(['adult', 'adult', 'kid']), { removed: 'kid' })).toEqual({ adults: 2, kidsCount: 1 })
    // Removing a listed child when the counter had one more: one fewer, the undescribed stays.
    expect(countsAfterChange({ adults: 2, kidsCount: 2 }, countGroups(['adult', 'adult']), { removed: 'kid' })).toEqual({ adults: 2, kidsCount: 1 })
  })

  it('changing someone’s age moves them from one group to the other', () => {
    expect(countsAfterChange({ adults: 2, kidsCount: 0 }, countGroups(['adult', 'kid']), { removed: 'adult', added: 'kid' })).toEqual({ adults: 1, kidsCount: 1 })
  })
})

describe('allergies of the people without an account (Seguridad)', () => {
  const now = new Date('2026-11-13T10:00:00Z')

  it('the facts in force, deduped like every other restriction', () => {
    expect(personRestrictionsInForce([
      { value: ['frutos secos', 'Sin gluten'], status: 'active', validUntil: null },
      { value: ['frutos secos'], status: 'active', validUntil: new Date('2026-12-01T00:00:00Z') },
      { value: ['marisco'], status: 'retired', validUntil: null },
      { value: ['huevo'], status: 'active', validUntil: new Date('2026-11-01T00:00:00Z') },
    ], now)).toEqual(['frutos secos', 'Sin gluten'])
  })

  it('the members’ restrictions read by the menu stay exactly as they were; the people’s only add', () => {
    // Both paths of today end in the account (`users.restrictions`): «Alergias e
    // intolerancias» and the old «Preferencias» card; Mimo writes the memory.
    const members = [
      { restrictions: ['sin gluten', 'marisco'], memoryRestrictions: ['marisco', 'pimiento'] },
      { restrictions: ['vegetariano'], memoryRestrictions: undefined },
    ]
    const before = unionMemberRestrictions(members)
    expect(mergeRestrictions([...before])).toEqual(before)
    const withPeople = mergeRestrictions([...before, ...personRestrictionsInForce([{ value: ['frutos secos'], status: 'active', validUntil: null }], now)])
    expect(withPeople.slice(0, before.length)).toEqual(before)
    expect(withPeople).toContain('frutos secos')
  })
})

describe('lists written by hand', () => {
  it('trimmed, lower case, without repeats or empties', () => {
    expect(cleanList([' Pimiento ', 'pimiento', '', 'Cilantro', 3])).toEqual(['pimiento', 'cilantro'])
  })
})
