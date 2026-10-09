/**
 * PRO-36 · "D · Luz y foto" on the access screens: /login, /register, /reset,
 * /invites/[token] and their shared shell must not use the old green palette.
 */
import { describe, expect, it } from 'vitest'
import { legacyPaletteHits } from './helpers/legacyPalette'

describe('redesign D · Acceso (PRO-36)', () => {
  it('uses no legacy green on the access pages', () => {
    expect(
      legacyPaletteHits([
        'apps/web/src/app/(auth)',
        'apps/web/src/app/invites',
        'apps/web/src/components/auth',
      ]),
    ).toEqual([])
  })
})
