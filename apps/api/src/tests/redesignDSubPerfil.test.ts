/**
 * PRO-40 — the /profile sub-pages are in "D · Luz y foto": none of them (nor
 * the components only they use) may fall back on the old green palette.
 */
import { describe, expect, it } from 'vitest'
import { legacyPaletteHits } from './helpers/legacyPalette'

const FILES = [
  'apps/web/src/app/profile/casa',
  'apps/web/src/app/profile/memoria',
  'apps/web/src/app/profile/creencias',
  'apps/web/src/app/profile/pantry',
  'apps/web/src/app/profile/staples',
  'apps/web/src/app/profile/cookbooks',
  'apps/web/src/components/profile/MemoryFactEditor.tsx',
  'apps/web/src/components/profile/SubPage.tsx',
]

describe('Rediseño D · subpáginas del perfil (PRO-40)', () => {
  it('no usan la paleta verde antigua', () => {
    expect(legacyPaletteHits(FILES)).toEqual([])
  })
})
