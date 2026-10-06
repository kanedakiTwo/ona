/**
 * import_recipe_from_url skill: URL validation, deep-link data and error
 * mapping. The import itself is mocked (it calls Claude + the DB).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../services/recipeImport.js', () => ({ importRecipeFromUrl: vi.fn() }))

import { importRecipeFromUrl } from '../services/recipeImport.js'
import { importRecipeFromUrlSkill, skills } from '../services/assistant/skills.js'
import { NotARecipeError } from '../services/recipeUrlExtractor.js'

describe('import_recipe_from_url skill', () => {
  const ctx = { userId: 'u1', db: null }
  beforeEach(() => {
    vi.mocked(importRecipeFromUrl).mockClear()
  })

  it('is registered with the assistant', () => {
    expect(skills.map((s) => s.name)).toContain('import_recipe_from_url')
  })

  it('rejects non-URLs without calling the extractor', async () => {
    const r = await importRecipeFromUrlSkill.handler({ url: 'lentejas de mi madre' }, ctx)
    expect(r.uiHint).toBe('text')
    expect(importRecipeFromUrl).not.toHaveBeenCalled()
  })

  it('returns the saved recipe id for the deep link', async () => {
    vi.mocked(importRecipeFromUrl).mockResolvedValue({ recipeId: 'r1', name: 'Lentejas', warnings: [] })
    const r = await importRecipeFromUrlSkill.handler({ url: 'https://youtu.be/abc' }, ctx)
    expect(importRecipeFromUrl).toHaveBeenCalledWith('https://youtu.be/abc', 'u1')
    expect(r).toMatchObject({ uiHint: 'recipe', data: { recipeId: 'r1', name: 'Lentejas' } })
    expect(r.summary).toContain('guardada')
  })

  it('turns "not a recipe" into a summary the model can relay', async () => {
    vi.mocked(importRecipeFromUrl).mockImplementation(async () => {
      throw new NotARecipeError('Es una noticia, no una receta')
    })
    const r = await importRecipeFromUrlSkill.handler({ url: 'https://elpais.com/x' }, ctx)
    expect(r).toMatchObject({ uiHint: 'text', data: null })
    expect(r.summary).toContain('Es una noticia')
  })
})
