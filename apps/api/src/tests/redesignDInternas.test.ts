/**
 * PRO-46 · "D · Luz y foto" on the internal pages (/admin, /curator,
 * /debug-advisor): no old green app palette as an accent.
 */
import { describe, expect, it } from 'vitest'
import { legacyPaletteHits } from './helpers/legacyPalette.js'

describe('Rediseño D · Internas (PRO-46)', () => {
  it('no usa la paleta verde antigua en /admin, /curator ni /debug-advisor', () => {
    expect(
      legacyPaletteHits([
        'apps/web/src/app/admin',
        'apps/web/src/app/curator',
        'apps/web/src/app/debug-advisor',
      ]),
    ).toEqual([])
  })
})
