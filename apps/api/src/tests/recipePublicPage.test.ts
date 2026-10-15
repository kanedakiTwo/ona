/**
 * One recipe page (specs/recipes.md → "Página de receta"): `/recipes/<id>`
 * and its cook mode are public for catalogue recipes — RootShell picks the
 * chrome from these route helpers — and shared links get a real preview from
 * `recipeMetadata` (apps/web/src/app/recipes/[id]/layout.tsx).
 */
import { describe, expect, it } from 'vitest'
import { isRecipeSegment, publicRecipeRoute } from '../../../web/src/lib/recipeShell'
import {
  GENERIC_RECIPE_METADATA,
  absoluteImageUrl,
  recipeMetadata,
  recipePreviewDescription,
} from '../../../web/src/lib/recipeMetadata'

describe('publicRecipeRoute', () => {
  it('the detail and cook mode of a recipe can be public', () => {
    expect(publicRecipeRoute('/recipes/3f1c0b8e-0000-4000-8000-000000000001')).toBe('detail')
    expect(publicRecipeRoute('/recipes/abc/')).toBe('detail')
    expect(publicRecipeRoute('/recipes/abc/cook')).toBe('cook')
  })

  it('only the detail and cook mode (the list /recipes is in lib/routeAccess.ts)', () => {
    for (const p of ['/recipes', '/recipes/', '/recipes/new', '/recipes/new/', '/recipes/abc/edit', '/menu', '', null, undefined]) {
      expect(publicRecipeRoute(p)).toBeNull()
    }
  })
})

describe('isRecipeSegment (root layout skips its default <title> there)', () => {
  it('covers the detail, cook and edit pages of a recipe', () => {
    expect(isRecipeSegment('/recipes/abc')).toBe(true)
    expect(isRecipeSegment('/recipes/abc/cook')).toBe(true)
    expect(isRecipeSegment('/recipes/abc/edit')).toBe(true)
  })

  it('not the catalogue nor /recipes/new', () => {
    expect(isRecipeSegment('/recipes')).toBe(false)
    expect(isRecipeSegment('/recipes/new')).toBe(false)
    expect(isRecipeSegment('/recipes-ona')).toBe(false)
  })
})

describe('recipeMetadata (link previews)', () => {
  const recipe = {
    id: 'r1',
    name: 'Lentejas con verduras',
    imageUrl: '/images/recipes/lentejas.jpg',
    servings: 4,
    prepTime: 15,
    cookTime: 30,
    ingredients: [{}, {}, {}],
  }

  it('title, description, canonical, Open Graph and a large card', () => {
    const m = recipeMetadata(recipe)
    expect(m.title).toBe('Lentejas con verduras · Mimoia')
    expect(m.description).toBe(
      'Receta para 4 personas · 45 min · 3 ingredientes. Ingredientes, pasos y modo cocina en Mimoia, el planificador de menús semanales.',
    )
    expect(m.alternates?.canonical).toBe('/recipes/r1')
    expect(m.metadataBase?.toString()).toBe('https://mimoia.com/')
    expect(m.openGraph).toMatchObject({
      url: '/recipes/r1',
      title: 'Lentejas con verduras',
      siteName: 'Mimoia',
      locale: 'es_ES',
      images: [{ url: 'https://mimoia.com/images/recipes/lentejas.jpg', alt: 'Lentejas con verduras' }],
    })
    expect(m.twitter).toMatchObject({ card: 'summary_large_image', images: ['https://mimoia.com/images/recipes/lentejas.jpg'] })
  })

  it('an absolute photo URL (API volume) is kept as is', () => {
    expect(absoluteImageUrl('https://ona-api-production.up.railway.app/images/recipes/x.jpg')).toBe(
      'https://ona-api-production.up.railway.app/images/recipes/x.jpg',
    )
    expect(absoluteImageUrl(null)).toBeNull()
  })

  it('no photo → no image tags; missing facts are left out', () => {
    const m = recipeMetadata({ id: 'r2', name: 'Caldo', imageUrl: null })
    expect((m.openGraph as { images?: unknown }).images).toBeUndefined()
    expect(recipePreviewDescription({ id: 'r2', name: 'Caldo', servings: 1 })).toMatch(/^Receta para 1 persona\. /)
  })

  it('a private or missing recipe gets generic, non-indexed metadata', () => {
    const m = recipeMetadata(null)
    expect(m).toBe(GENERIC_RECIPE_METADATA)
    expect(m.title).toBe('Receta · Mimoia')
    expect(m.robots).toEqual({ index: false })
    expect(m.alternates).toBeUndefined()
  })
})
