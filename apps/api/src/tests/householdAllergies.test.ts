/**
 * PRO-271 (Seguridad): who in the household has said their allergies and
 * diet. «No ha contestado» (nothing saved, no consent) is not «contestó que
 * ninguna» (consent in force, nothing saved), and the weekly menu reads every
 * member's restrictions, not only the generating user's.
 */
import { describe, expect, it } from 'vitest'
import { allergiesAnswered, householdAllergiesStatus, unionMemberRestrictions, type AllergyMember } from '../services/householdAllergies.js'
import { compileRestrictions } from '../services/dietaryRestrictions.js'

const member = (over: Partial<AllergyMember>): AllergyMember => ({
  userId: 'u',
  username: 'u',
  restrictions: [],
  memoryRestrictions: undefined,
  consentAt: null,
  withdrawnAt: null,
  ...over,
})

describe('allergiesAnswered', () => {
  it('nothing saved and no consent → has not answered', () => {
    expect(allergiesAnswered(member({}))).toBe(false)
  })
  it('consent in force with nothing saved → answered «ninguna»', () => {
    expect(allergiesAnswered(member({ consentAt: '2026-10-20T10:00:00Z' }))).toBe(true)
  })
  it('consent withdrawn afterwards → not answered any more', () => {
    expect(allergiesAnswered(member({ consentAt: '2026-10-01T10:00:00Z', withdrawnAt: '2026-10-10T10:00:00Z' }))).toBe(false)
  })
  it('restrictions in the profile or in Mimo’s memory → answered', () => {
    expect(allergiesAnswered(member({ restrictions: ['marisco'] }))).toBe(true)
    expect(allergiesAnswered(member({ memoryRestrictions: ['sin lactosa'] }))).toBe(true)
  })
  it('blank strings don’t count as an answer', () => {
    expect(allergiesAnswered(member({ restrictions: ['  '], memoryRestrictions: 'marisco' }))).toBe(false)
  })
})

describe('householdAllergiesStatus', () => {
  const ana = member({ userId: 'ana', username: 'ana' })
  const victor = member({ userId: 'victor', username: 'victor', restrictions: ['marisco', 'vegetariano'], consentAt: '2026-10-20T10:00:00Z' })

  it('nobody answered: the caller is asked, nobody else pending', () => {
    expect(householdAllergiesStatus([ana], 'ana')).toEqual({ meAnswered: false, pending: [], anyAnswered: false })
  })
  it('the invited person answered, the owner did not', () => {
    expect(householdAllergiesStatus([ana, victor], 'victor')).toEqual({ meAnswered: true, pending: ['ana'], anyAnswered: true })
    expect(householdAllergiesStatus([ana, victor], 'ana')).toEqual({ meAnswered: false, pending: [], anyAnswered: true })
  })
  it('a member who joined before PRO-271 and never answered is pending for the owner', () => {
    const owner = member({ userId: 'o', username: 'o', consentAt: '2026-10-01T10:00:00Z' })
    const newcomer = member({ userId: 'n', username: 'marina' })
    expect(householdAllergiesStatus([owner, newcomer], 'o')).toEqual({ meAnswered: true, pending: ['marina'], anyAnswered: true })
  })
})

describe('unionMemberRestrictions', () => {
  it('merges every member’s profile and memory, deduped', () => {
    const out = unionMemberRestrictions([
      { restrictions: ['sin gluten'], memoryRestrictions: undefined },
      { restrictions: ['marisco', 'Sin gluten'], memoryRestrictions: ['sin lactosa'] },
    ])
    expect(out).toEqual(['sin gluten', 'marisco', 'sin lactosa'])
  })
  it('«marisco» from a member compiles to the crustacean allergen for the whole menu', () => {
    const rules = compileRestrictions(unionMemberRestrictions([{ restrictions: [] }, { restrictions: ['marisco'] }]), [])
    expect(rules.allergens.has('crustaceos')).toBe(true)
  })
})
