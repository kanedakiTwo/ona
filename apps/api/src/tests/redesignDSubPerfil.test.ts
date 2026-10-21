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
  // «Tu ficha» (PRO-318)
  'apps/web/src/app/profile/ficha',
  'apps/web/src/components/ficha',
]

/**
 * The one green allowed: «Aprender de lo que hago» is forest when on, as in
 * the «Tu ficha» design Miguel approved on 2026-10-21 (PRO-318).
 */
const ALLOWED = [/^apps\/web\/src\/components\/ficha\/LearningSwitch\.tsx:\d+: bg-forest$/]

describe('Rediseño D · subpáginas del perfil (PRO-40)', () => {
  it('no usan la paleta verde antigua', () => {
    expect(legacyPaletteHits(FILES).filter((hit) => !ALLOWED.some((re) => re.test(hit)))).toEqual([])
  })
})
