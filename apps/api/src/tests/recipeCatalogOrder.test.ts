/**
 * PRO-140: catalogue order (households with it in favourites, then Miguel's
 * featured list, then oldest first), retired recipes, and the renamed seed
 * names (specs/recipes.md).
 */
import { describe, expect, it } from 'vitest'
import { FEATURED_RECIPES } from '@ona/shared'
import { featuredRank, isRetiredRecipe, sortCatalog } from '../services/recipeCatalogOrder.js'
import { seedRecipes } from '../seed/recipes.js'
import { NOTION_SOURCE_LINKS } from '../seed/notionSourceLinks.js'
import { buildLinkIndex, matchSourceLink } from '../services/catalogSourceLinks.js'
import { CATALOG_RENAMES } from '../services/recipeRenames.js'

const row = (id: string, name: string, favoriteHouseholds = 0, createdAt = '2026-01-01T00:00:00Z') => ({ id, name, favoriteHouseholds, createdAt })

describe('sortCatalog', () => {
  it('a recipe with 2 households in favourites goes before a featured one with 0', () => {
    const out = sortCatalog([row(FEATURED_RECIPES[0].id, 'Arroz con bacalao'), row('x', 'Tortilla', 2)])
    expect(out.map((r) => r.name)).toEqual(['Tortilla', 'Arroz con bacalao'])
  })

  it('among those with 0, the featured list order, then the rest oldest first', () => {
    const out = sortCatalog([
      row('old', 'Lentejas guisadas', 0, '2026-01-01T00:00:00Z'),
      row('b', 'Bacalao con tomate'),
      row('newer', 'Falafel', 0, '2026-02-01T00:00:00Z'),
      row('a', 'Arroz con bacalao'),
    ])
    expect(out.map((r) => r.name)).toEqual(['Arroz con bacalao', 'Bacalao con tomate', 'Lentejas guisadas', 'Falafel'])
  })

  it('featured matches by id, else by name without accents or case (staging ids differ)', () => {
    expect(featuredRank({ id: FEATURED_RECIPES[3].id, name: 'cualquier' })).toBe(3)
    expect(featuredRank({ id: 'staging-id', name: 'COCIDO MADRILENO' })).toBe(3)
    expect(featuredRank({ id: 'z', name: 'Tortilla' })).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('retired recipes', () => {
  it('only catalogue recipes tagged «retirada»', () => {
    expect(isRetiredRecipe({ authorId: null, internalTags: ['compartida', 'retirada'] })).toBe(true)
    expect(isRetiredRecipe({ authorId: null, internalTags: ['compartida'] })).toBe(false)
    expect(isRetiredRecipe({ authorId: 'u1', internalTags: ['retirada'] })).toBe(false)
  })
})

describe('renamed catalogue recipes (no «Gipsy», accents back)', () => {
  it('no seed recipe has «gipsy» in its name', () => {
    expect(seedRecipes.filter((r) => /gipsy/i.test(r.name)).map((r) => r.name)).toEqual([])
  })

  it('no seed recipe still uses an old name', () => {
    const old = new Set(CATALOG_RENAMES.map(([o]) => o))
    expect(seedRecipes.filter((r) => old.has(r.name)).map((r) => r.name)).toEqual([])
  })

  it('the renamed recipes keep their original link («Ver fuente»)', () => {
    const index = buildLinkIndex(NOTION_SOURCE_LINKS)
    expect(matchSourceLink('Fideuá', index)).toBe(matchSourceLink('Fidegua gipsy', index))
    expect(matchSourceLink('Fideuá', index)).not.toBeNull()
    expect(matchSourceLink('Curry cremoso de tofu', index)).toBe(matchSourceLink('Vegan butter chicken', index))
    expect(matchSourceLink('Albóndigas express', index)).not.toBeNull()
  })
})
