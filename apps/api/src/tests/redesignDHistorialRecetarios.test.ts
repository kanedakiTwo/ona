/**
 * "D · Luz y foto" on /menu/history and /cookbooks/[id] (PRO-43).
 *
 * - Neither page (nor the shared pieces they lean on) uses the old green
 *   app palette or the generic Tailwind grays / black of the pre-D pages.
 * - The history week cards' thumbnails come from `weekCovers`
 *   (apps/web/src/lib/menuHistory.ts): distinct recipes, photos first,
 *   capped, with the total for the "+N" tile.
 *
 * Run: pnpm --filter @ona/api test src/tests/redesignDHistorialRecetarios.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { legacyPaletteHits, REPO } from './helpers/legacyPalette'
import { createdLabel, weekCovers } from '../../../web/src/lib/menuHistory'

const PAGES = ['apps/web/src/app/menu/history/page.tsx', 'apps/web/src/app/cookbooks/[id]/page.tsx']
const FILES = [
  ...PAGES,
  'apps/web/src/lib/menuHistory.ts',
  'apps/web/src/components/recipes/CatalogGrid.tsx',
  'apps/web/src/components/menu/RecipeCover.tsx',
  'apps/web/src/components/menu/MenuSheet.tsx',
]

describe('redesign D · historial y recetarios — palette', () => {
  it('uses no legacy green palette', () => {
    expect(legacyPaletteHits(FILES)).toEqual([])
  })

  it('uses D tokens instead of generic grays, black or hard-coded hex colours', () => {
    const generic = /\b(?:bg|text|border|ring)-(?:gray|red|black)\b(?:-\d+)?|\[#[0-9a-f]{3,8}\]/gi
    const hits = PAGES.flatMap((p) =>
      readFileSync(resolve(REPO, p), 'utf8')
        .split('\n')
        .flatMap((line, i) => [...line.matchAll(generic)].map((m) => `${p}:${i + 1}: ${m[0]}`)),
    )
    expect(hits).toEqual([])
  })

  it('history uses RecipeCover thumbnails; the cookbook uses CatalogGrid and a "···" sheet', () => {
    const history = readFileSync(resolve(REPO, PAGES[0]), 'utf8')
    const cookbook = readFileSync(resolve(REPO, PAGES[1]), 'utf8')
    expect(history).toMatch(/<RecipeCover\b/)
    expect(cookbook).toMatch(/<CatalogGrid\b/)
    expect(cookbook).toMatch(/<MenuSheet\b/)
    // No function lost: edit, delete and per-recipe removal are all still there.
    expect(cookbook).toContain('Editar recetario')
    expect(cookbook).toContain('Borrar recetario')
    expect(cookbook).toContain('Quitar del recetario')
  })
})

const dish = (recipeId: string, imageUrl: string | null = null) => ({
  kind: 'recipe' as const,
  recipeId,
  recipeName: `Receta ${recipeId}`,
  imageUrl,
})

describe('weekCovers', () => {
  it('returns nothing for a missing or empty week', () => {
    expect(weekCovers(undefined)).toEqual({ covers: [], total: 0 })
    expect(weekCovers([{}, { lunch: { dishes: [] } }])).toEqual({ covers: [], total: 0 })
  })

  it('dedupes recipes, puts photos first and caps the covers', () => {
    const days = [
      { dinner: { dishes: [dish('a')] }, breakfast: { dishes: [dish('b', '/b.jpg')] } },
      { lunch: { dishes: [dish('a'), dish('c', '/c.jpg'), { kind: 'text', text: 'Fruta' } as never] } },
      { lunch: { dishes: [dish('d')] }, snack: { dishes: [dish('e', '/e.jpg')] } },
    ]
    const { covers, total } = weekCovers(days, 4)
    expect(total).toBe(5)
    expect(covers.map((c) => c.recipeId)).toEqual(['b', 'c', 'e', 'a'])
    expect(covers[0]).toEqual({ recipeId: 'b', name: 'Receta b', imageUrl: '/b.jpg', meal: 'breakfast' })
    expect(covers[3].meal).toBe('dinner')
  })
})

describe('createdLabel', () => {
  it('formats the creation date in Spanish and tolerates bad input', () => {
    expect(createdLabel('2026-10-09T10:00:00Z')).toBe('Creado el 9 de octubre de 2026')
    expect(createdLabel('nope')).toBe('')
  })
})
