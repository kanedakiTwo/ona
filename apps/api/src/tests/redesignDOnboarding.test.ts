/**
 * PRO-37: /onboarding and /onboarding/voz are in "D · Luz y foto" — no old
 * green app palette (forest/mint/leaf) in the pages or in the components
 * only they use.
 */
import { describe, it, expect } from 'vitest'
import { legacyPaletteHits } from './helpers/legacyPalette.js'

describe('redesign D · Onboarding', () => {
  it('uses no legacy green palette', () => {
    expect(
      legacyPaletteHits(['apps/web/src/app/onboarding', 'apps/web/src/components/onboarding']),
    ).toEqual([])
  })
})
