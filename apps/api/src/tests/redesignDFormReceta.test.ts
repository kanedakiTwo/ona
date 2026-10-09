/**
 * PRO-42 · "D · Luz y foto" on the recipe forms (`/recipes/new`,
 * `/recipes/[id]/edit`) and the form-only components they use: no old green
 * app palette (forest/mint/leaf) anywhere in them.
 */
import { describe, it, expect } from 'vitest'
import { legacyPaletteHits } from './helpers/legacyPalette.js'

const FILES = [
  'apps/web/src/app/recipes/new',
  'apps/web/src/app/recipes/[id]/edit',
  'apps/web/src/components/recipes/form',
  'apps/web/src/components/recipes/PhotoRecipeUpload.tsx',
  'apps/web/src/components/recipes/UrlRecipeImport.tsx',
  'apps/web/src/components/recipes/SortableIngredientsList.tsx',
  'apps/web/src/components/recipes/SortableStepsList.tsx',
  'apps/web/src/components/recipes/IngredientAutocomplete.tsx',
  'apps/web/src/components/recipes/IngredientCandidateCard.tsx',
  'apps/web/src/components/recipes/FitChip.tsx',
]

describe('PRO-42 · recipe forms in "D · Luz y foto"', () => {
  it('use no legacy green palette', () => {
    expect(legacyPaletteHits(FILES)).toEqual([])
  })
})
