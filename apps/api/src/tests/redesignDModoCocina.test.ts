/**
 * PRO-45 · "D · Luz y foto" in cook mode (`/recipes/[id]/cook`): the page and
 * the cooking components only it uses must not fall back to the old green
 * app palette (forest/leaf/mint accents, mint chips).
 */
import { describe, expect, it } from 'vitest'
import { legacyPaletteHits } from './helpers/legacyPalette'

const FILES = [
  'apps/web/src/app/recipes/[id]/cook',
  'apps/web/src/components/cooking',
]

describe('Rediseño D · Modo cocina', () => {
  it('no usa la paleta verde antigua', () => {
    expect(legacyPaletteHits(FILES)).toEqual([])
  })
})
