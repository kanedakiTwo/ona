/**
 * PRO-397: the e2e copy of the real catalogue (scripts/e2eRealCatalog.ts)
 * turns staging's public API JSON into rows of our tables.
 */
import { describe, expect, it } from 'vitest'
import { ingredientRow, realCatalogDatabaseUrl, recipeRows } from '../../scripts/e2eRealCatalog.js'

describe('realCatalogDatabaseUrl', () => {
  it('puts the copy next to the suite database, keeping the rest', () => {
    expect(realCatalogDatabaseUrl('postgresql://postgres:postgres@localhost:5432/onatest')).toBe(
      'postgresql://postgres:postgres@localhost:5432/onatest_catalogo_real',
    )
    expect(realCatalogDatabaseUrl('postgresql://u@localhost/db?host=/var/run/postgresql')).toBe(
      'postgresql://u@localhost/db_catalogo_real?host=/var/run/postgresql',
    )
  })
})

describe('ingredientRow', () => {
  it('maps the columns, JSON as text, and leaves absent NOT NULL ones to their default', () => {
    const row = ingredientRow({
      id: 'i1',
      name: 'ajo',
      aisle: 'verdura',
      unitWeight: 5,
      allergenTags: [],
      vitamins: { c: 31 },
      prepRequirements: null,
      edibleFraction: null,
      createdAt: '2026-10-25T08:21:51.855Z',
    })
    expect(row.table).toBe('ingredients')
    expect(row.values).toEqual({
      id: 'i1',
      name: 'ajo',
      aisle: 'verdura',
      unit_weight: 5,
      allergen_tags: [],
      vitamins: '{"c":31}',
      prep_requirements: null,
    })
  })
})

describe('recipeRows', () => {
  it('gives the catalogue recipe (course from the listing), its ingredients and its steps', () => {
    const rows = recipeRows(
      {
        id: 'r1',
        name: 'Menestra',
        authorId: null,
        servings: 4,
        meals: ['lunch'],
        mealFit: { lunch: 'perfect' },
        ingredients: [
          { id: 'ri1', ingredientId: 'i1', quantity: 10, unit: 'g', note: 'picado' },
          { id: 'ri2', ingredientId: 'i2', quantity: 1, unit: 'u', displayOrder: 7 },
        ],
        steps: [{ index: 0, text: 'Pica el ajo.', ingredientRefs: ['ri1'], durationMin: 2 }],
      },
      'main',
    )
    expect(rows.map((r) => r.table)).toEqual(['recipes', 'recipe_ingredients', 'recipe_ingredients', 'recipe_steps'])
    expect(rows[0].values).toMatchObject({ id: 'r1', author_id: null, course: 'main', servings: 4, meal_fit: '{"lunch":"perfect"}', difficulty: 'medium' })
    expect(rows[1].values).toMatchObject({ id: 'ri1', recipe_id: 'r1', ingredient_id: 'i1', note: 'picado', display_order: 0 })
    expect(rows[2].values).toMatchObject({ display_order: 7, optional: false })
    expect(rows[3].values).toMatchObject({ recipe_id: 'r1', index: 0, ingredient_refs: ['ri1'], duration_min: 2, temperature: null })
  })
})
