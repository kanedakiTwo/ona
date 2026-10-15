/**
 * PRO-66 (1): the photo extractor says whether the photo looks like a
 * screenshot of a web page or a social network (`looksLikeScreenshot`), in
 * the SAME vision call that reads the recipe (no extra paid call). Claude is
 * simulated: no real provider is called.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create }
  },
}))
vi.mock('../config/env.js', () => ({ env: { ANTHROPIC_API_KEY: 'test-key' } }))
vi.mock('../services/costLedger.js', () => ({ recordAnthropicCost: vi.fn() }))
vi.mock('../db/connection.js', () => ({
  db: { select: () => ({ from: async () => [] }) },
}))

import { AnthropicProvider } from '../services/providers/anthropic.js'
import { extractRecipeFromImage } from '../services/recipeExtractor.js'

function reply(json: Record<string, unknown>) {
  return { content: [{ type: 'text', text: JSON.stringify(json) }], usage: { input_tokens: 1, output_tokens: 1 } }
}

const RECIPE = {
  name: 'Tortilla de patatas',
  servings: 4,
  servingsConfidence: 'explicit',
  prepTime: 30,
  ingredients: [],
  steps: ['Pelar las patatas', 'Freír', 'Cuajar con el huevo'],
  suggestedMeals: ['dinner'],
  suggestedSeasons: ['winter'],
  tags: [],
}

describe('photo extractor: looksLikeScreenshot (PRO-66)', () => {
  beforeEach(() => create.mockReset())

  it('a screenshot of Instagram → looksLikeScreenshot: true', async () => {
    create.mockResolvedValue(reply({ ...RECIPE, looksLikeScreenshot: true }))
    const raw = await new AnthropicProvider().extractRecipe('aGVsbG8=', 'image/png')
    expect(raw.looksLikeScreenshot).toBe(true)
  })

  it('a photo of a cookbook page → looksLikeScreenshot: false', async () => {
    create.mockResolvedValue(reply({ ...RECIPE, looksLikeScreenshot: false }))
    const raw = await new AnthropicProvider().extractRecipe('aGVsbG8=', 'image/jpeg')
    expect(raw.looksLikeScreenshot).toBe(false)
  })

  it('a model that says nothing about it → false (never asks by mistake)', async () => {
    create.mockResolvedValue(reply(RECIPE))
    const raw = await new AnthropicProvider().extractRecipe('aGVsbG8=', 'image/jpeg')
    expect(raw.looksLikeScreenshot).toBe(false)
  })

  it('the question is part of the one vision call that reads the recipe', async () => {
    create.mockResolvedValue(reply({ ...RECIPE, looksLikeScreenshot: true }))
    await new AnthropicProvider().extractRecipe('aGVsbG8=', 'image/png')
    expect(create).toHaveBeenCalledTimes(1)
    const prompt = JSON.stringify(create.mock.calls[0][0].messages)
    expect(prompt).toContain('looksLikeScreenshot')
  })

  it('the draft for /recipes/new carries the signal', async () => {
    create.mockResolvedValue(reply({ ...RECIPE, looksLikeScreenshot: true }))
    const draft = await extractRecipeFromImage(new AnthropicProvider(), Buffer.from('x'), 'image/png')
    expect(draft.looksLikeScreenshot).toBe(true)
    create.mockResolvedValue(reply({ ...RECIPE, looksLikeScreenshot: false }))
    const book = await extractRecipeFromImage(new AnthropicProvider(), Buffer.from('x'), 'image/jpeg')
    expect(book.looksLikeScreenshot).toBe(false)
  })
})
