/**
 * PRO-1077 — SEO de la ficha (specs/recipes.md): the `schema.org/Recipe`
 * JSON-LD of a catalogue recipe (lib/recipeJsonLd.ts, written by the `@seo`
 * slot) and the recipes in `sitemap.xml`: published catalogue recipes, a
 * creator's in, a book's out (D-104) until Legal's OK; a book recipe's page
 * is `noindex` too.
 */
import { describe, expect, it } from 'vitest'
import { isBookRecipe, sitemapRecipes } from '../services/recipeSeo.js'
import { ingredientLine, isoDuration, jsonLdScript, recipeJsonLd, type JsonLdRecipe } from '../../../web/src/lib/recipeJsonLd'
import { recipeMetadata } from '../../../web/src/lib/recipeMetadata'
import { PUBLIC_PAGES, sitemapEntries } from '../../../web/src/lib/sitemap'
import type { CatalogSourceInfo } from '../db/schema.js'

const source = (over: Partial<CatalogSourceInfo>): CatalogSourceInfo => ({
  origin: 'cocina',
  batch: 'b1',
  auditIssues: [],
  allergenDoubt: false,
  ...over,
})

const creator = source({ credit: 'Receta de @lacocinadeirene' })
const book = source({ origin: 'miguel', book: 'Jerusalem', credit: 'Inspirada en una receta de Yotam Ottolenghi, «Jerusalem»' })

const lentejas: JsonLdRecipe = {
  id: '3f1c0b8e-0000-4000-8000-000000000001',
  name: 'Lentejas con verduras',
  imageUrl: '/images/recipes/lentejas.jpg',
  servings: 4,
  prepTime: 15,
  cookTime: 75,
  course: 'main',
  meals: ['lunch', 'dinner'],
  tags: ['legumbres', 'de cuchara'],
  sourceUrl: 'https://www.instagram.com/p/abc/',
  nutritionPerServing: { kcal: 412.6 },
  ingredients: [
    { ingredientName: 'lenteja pardina', quantity: 300, unit: 'g' },
    { ingredientName: 'zanahoria', quantity: 2, unit: 'u', note: 'en dados' },
    { ingredientName: 'sal', quantity: 0, unit: 'al_gusto' },
    { ingredientName: 'agua', quantity: 0, unit: 'ml' },
  ],
  steps: [
    { index: 1, text: 'Añade las lentejas y cubre de agua.' },
    { index: 0, text: 'Sofríe la zanahoria en una olla.' },
  ],
}

describe('recipeJsonLd (schema.org/Recipe)', () => {
  it('a catalogue recipe: valid Recipe JSON-LD with ingredients, our steps, ISO times and Mimoia as author', () => {
    const ld = JSON.parse(jsonLdScript(recipeJsonLd(lentejas)!))
    expect(ld).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      url: 'https://mimoia.com/recipes/3f1c0b8e-0000-4000-8000-000000000001',
      name: 'Lentejas con verduras',
      image: ['https://mimoia.com/images/recipes/lentejas.jpg'],
      author: { '@type': 'Organization', name: 'Mimoia', url: 'https://mimoia.com' },
      prepTime: 'PT15M',
      cookTime: 'PT1H15M',
      totalTime: 'PT1H30M',
      recipeYield: ['4 personas'],
      recipeCategory: 'Plato principal',
      keywords: 'legumbres, de cuchara',
      nutrition: { '@type': 'NutritionInformation', calories: '413 kcal' },
      isBasedOn: 'https://www.instagram.com/p/abc/',
    })
    expect(ld.description).toMatch(/^Receta para 4 personas · 1 h 30 min · 4 ingredientes\./)
    expect(ld.recipeIngredient).toEqual([
      'Lenteja pardina (300 g)',
      'Zanahoria (2 uds), en dados',
      'Sal (al gusto)',
      'Agua',
    ])
    expect(ld.recipeInstructions).toEqual([
      { '@type': 'HowToStep', position: 1, text: 'Sofríe la zanahoria en una olla.' },
      { '@type': 'HowToStep', position: 2, text: 'Añade las lentejas y cubre de agua.' },
    ])
    // Every value is set: no null/undefined left for a validator to reject.
    for (const v of Object.values(ld)) expect(v).not.toBeNull()
  })

  it('what the recipe lacks is left out (no photo, no times, no source); meals as category without a course', () => {
    const ld = recipeJsonLd({ id: 'r2', name: 'Tostada', servings: 1, meals: ['breakfast'], ingredients: [], steps: [] })!
    expect(ld).not.toHaveProperty('image')
    expect(ld).not.toHaveProperty('prepTime')
    expect(ld).not.toHaveProperty('totalTime')
    expect(ld).not.toHaveProperty('isBasedOn')
    expect(ld).not.toHaveProperty('nutrition')
    expect(ld.recipeCategory).toBe('Desayuno')
    expect(ld.recipeYield).toEqual(['1 persona'])
  })

  it('incomplete nutrition gives no calories', () => {
    expect(recipeJsonLd({ ...lentejas, nutritionIncomplete: true })).not.toHaveProperty('nutrition')
  })

  it('a book recipe, a private or a missing one: no JSON-LD', () => {
    expect(recipeJsonLd({ ...lentejas, fromBook: true })).toBeNull()
    expect(recipeJsonLd(null)).toBeNull()
  })

  it('a recipe text cannot close the <script> tag', () => {
    const out = jsonLdScript(recipeJsonLd({ ...lentejas, name: 'Pisto </script><script>alert(1)</script>' })!)
    expect(out).not.toContain('</script>')
    expect(JSON.parse(out).name).toBe('Pisto </script><script>alert(1)</script>')
  })

  it('isoDuration and ingredientLine', () => {
    expect(isoDuration(45)).toBe('PT45M')
    expect(isoDuration(60)).toBe('PT1H')
    expect(isoDuration(0)).toBeNull()
    expect(isoDuration(null)).toBeNull()
    expect(ingredientLine({ ingredientName: 'sal', quantity: 1, unit: 'pizca' })).toBe('Sal (una pizca)')
    expect(ingredientLine({ ingredientName: ' ', quantity: 1, unit: 'g' })).toBeNull()
  })
})

describe('book recipes (D-104) stay out of search engines', () => {
  it('isBookRecipe: a book in the source or a credit quoting one', () => {
    expect(isBookRecipe(book)).toBe(true)
    expect(isBookRecipe(source({ credit: 'Inspirada en una receta de Ottolenghi, «Simple»' }))).toBe(true)
    expect(isBookRecipe(source({ origin: 'miguel', book: 'Jerusalem' }))).toBe(true)
    expect(isBookRecipe(creator)).toBe(false)
    expect(isBookRecipe(source({ credit: 'Receta de la Yaya' }))).toBe(false)
    expect(isBookRecipe(null)).toBe(false)
  })

  it('the page of a book recipe keeps its preview but is noindex; a creator recipe is indexed', () => {
    expect(recipeMetadata({ id: 'b', name: 'Shakshuka', fromBook: true }).robots).toEqual({ index: false })
    expect(recipeMetadata({ id: 'c', name: 'Pisto' }).robots).toBeUndefined()
  })
})

describe('sitemap.xml', () => {
  const rows = [
    { id: 'creadora-1', updatedAt: new Date('2026-10-20T10:00:00Z'), catalogSource: creator },
    { id: 'libro-1', updatedAt: new Date('2026-10-21T10:00:00Z'), catalogSource: book },
    { id: 'mimoia-1', updatedAt: null, catalogSource: null },
  ]

  it('includes a creator recipe and not a book one', () => {
    const urls = sitemapEntries([], sitemapRecipes(rows)).map((e) => e.url)
    expect(urls).toContain('https://mimoia.com/recipes/creadora-1')
    expect(urls).toContain('https://mimoia.com/recipes/mimoia-1')
    expect(urls).not.toContain('https://mimoia.com/recipes/libro-1')
  })

  it('keeps the public pages and blog, with lastModified when known', () => {
    const entries = sitemapEntries([{ slug: 'menu-semanal', fecha: '2026-10-01' }], sitemapRecipes(rows))
    expect(entries.slice(0, PUBLIC_PAGES.length).map((e) => e.url)).toEqual(PUBLIC_PAGES.map((p) => `https://mimoia.com${p}`))
    expect(entries).toContainEqual({ url: 'https://mimoia.com/blog/menu-semanal', lastModified: '2026-10-01' })
    expect(entries).toContainEqual({ url: 'https://mimoia.com/recipes/creadora-1', lastModified: '2026-10-20T10:00:00.000Z' })
    expect(entries).toContainEqual({ url: 'https://mimoia.com/recipes/mimoia-1' })
  })
})
