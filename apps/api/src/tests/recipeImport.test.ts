/**
 * Shared import path (URL route, import_recipe_from_url skill, WhatsApp
 * photos): the pure extractor → write-input mapping.
 */
import { describe, it, expect } from 'vitest'
import type { ExtractedRecipe } from '@ona/shared'
import { extractedToWriteInput } from '../services/recipeImport.js'

const extracted = (over: Partial<ExtractedRecipe> = {}): ExtractedRecipe => ({
  name: 'Lentejas estofadas',
  imageUrl: 'https://img/x.jpg',
  servings: 4,
  servingsConfidence: 'explicit',
  prepTime: 10,
  cookTime: 40,
  meals: ['lunch'],
  seasons: ['autumn'],
  difficulty: null,
  tags: ['legumbres'],
  steps: ['Sofríe', 'Cuece'],
  ingredients: [
    { extractedName: 'lentejas', ingredientId: 'ing-1', ingredientName: 'Lentejas', quantity: 300, unit: 'g', matched: true },
    { extractedName: 'unicornio', ingredientId: null, ingredientName: null, quantity: 1, unit: 'u', matched: false },
    { extractedName: 'cebolla', ingredientId: 'ing-2', ingredientName: 'Cebolla', quantity: 1, unit: 'u', matched: true },
  ] as any,
  unmatchedCount: 1,
  warnings: ['1 ingrediente(s) no encontrado(s)'],
  ...over,
})

describe('extractedToWriteInput', () => {
  it('keeps only matched ingredients with sequential display order and numbers the steps', () => {
    const w = extractedToWriteInput(extracted(), { internalTags: ['auto-extracted', 'from-photo'] })
    expect(w.ingredients).toEqual([
      { ingredientId: 'ing-1', quantity: 300, unit: 'g', displayOrder: 0 },
      { ingredientId: 'ing-2', quantity: 1, unit: 'u', displayOrder: 1 },
    ])
    expect(w.steps).toEqual([{ index: 0, text: 'Sofríe' }, { index: 1, text: 'Cuece' }])
    expect(w.difficulty).toBe('medium')
    expect(w.internalTags).toEqual(['auto-extracted', 'from-photo'])
    expect(w.imageUrl).toBe('https://img/x.jpg')
  })

  it('prefers the extractor sourceUrl and falls back to the requested URL', () => {
    expect(extractedToWriteInput(extracted({ sourceUrl: 'https://canonical' }), { internalTags: [], sourceUrl: 'https://shared' }).sourceUrl).toBe('https://canonical')
    expect(extractedToWriteInput(extracted(), { internalTags: [], sourceUrl: 'https://shared' }).sourceUrl).toBe('https://shared')
    expect(extractedToWriteInput(extracted(), { internalTags: [] }).sourceUrl).toBeNull()
  })
})
