/**
 * PRO-39 · "D · Luz y foto" on /profile (the profile front page and the
 * components only it uses). The sub-pages (/profile/casa, memoria…) belong
 * to PRO-40 and have their own guard.
 */
import { describe, expect, it } from 'vitest'
import { legacyPaletteHits } from './helpers/legacyPalette'

const PROFILE_FILES = [
  'apps/web/src/app/profile/page.tsx',
  'apps/web/src/app/profile/sections',
  'apps/web/src/components/profile/WhatsAppCard.tsx',
  'apps/web/src/components/profile/DeleteAccountCard.tsx',
  'apps/web/src/components/profile/MealDishCountControls.tsx',
]

describe('redesign D · Perfil (PRO-39)', () => {
  it('uses no legacy green palette on /profile', () => {
    expect(legacyPaletteHits(PROFILE_FILES)).toEqual([])
  })
})
