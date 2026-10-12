/**
 * PRO-64: /profile used to read restrictions only from `user_settings`, so
 * "vegetariano" or "sin gluten" picked in onboarding (stored in
 * `users.restrictions`) showed unticked. The profile now shows the union of
 * both stores and saves it back to both.
 */
import { describe, expect, it } from 'vitest'
import { unionRestrictions } from '@ona/shared'

describe('unionRestrictions', () => {
  it('joins account and settings restrictions, account first', () => {
    expect(unionRestrictions(['vegetariano'], ['sin lactosa'])).toEqual(['vegetariano', 'sin lactosa'])
  })

  it('keeps the onboarding ones when the settings blob has none', () => {
    expect(unionRestrictions(['sin gluten'], [])).toEqual(['sin gluten'])
    expect(unionRestrictions(['sin gluten'], undefined)).toEqual(['sin gluten'])
  })

  it('dedupes ignoring case and spaces (lowercase, as the profile chips write them)', () => {
    expect(unionRestrictions(['Sin gluten '], ['sin gluten', 'vegano'])).toEqual(['sin gluten', 'vegano'])
  })

  it('ignores junk (null, non-strings, empty)', () => {
    expect(unionRestrictions(null, ['', 3 as unknown as string, 'huevo'])).toEqual(['huevo'])
  })
})
