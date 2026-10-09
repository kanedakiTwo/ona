/**
 * PRO-44: /whatsapp/conectar and /offline moved to "D · Luz y foto" — no old
 * green app palette left as an accent on either page.
 */
import { describe, expect, it } from 'vitest'
import { legacyPaletteHits } from './helpers/legacyPalette'

describe('redesign D · /whatsapp/conectar and /offline', () => {
  it('uses no legacy green palette', () => {
    expect(legacyPaletteHits(['apps/web/src/app/whatsapp/conectar', 'apps/web/src/app/offline'])).toEqual([])
  })
})
