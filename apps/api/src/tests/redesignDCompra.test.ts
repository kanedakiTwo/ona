/**
 * PRO-38 — "D · Luz y foto" on /shopping (lista y despensa): the page and
 * the components only it uses must not fall back to the old green app
 * palette (forest as accent, the mint chip).
 */
import { describe, it, expect } from 'vitest'
import { legacyPaletteHits } from './helpers/legacyPalette.js'

describe('redesign D · Compra (/shopping)', () => {
  it('uses no legacy green palette', () => {
    expect(
      legacyPaletteHits([
        'apps/web/src/app/shopping',
        'apps/web/src/components/shopping',
      ]),
    ).toEqual([])
  })
})
