/**
 * House-style recipe photos (services/recipeHouseImage.ts,
 * recipeImageCheck.ts, recipeImageGenerator.ts): prompt, provider order,
 * the generate → check → retry loop, and which images get replaced.
 */
import { describe, it, expect, vi } from 'vitest'
import { dishLine, isReplaceableImage, makeHouseImage, type Dish, type HouseImageDeps } from '../services/recipeHouseImage.js'
import { checkRecipeImage, describeDish, normalizeVerdict, type ImageVerdict } from '../services/recipeImageCheck.js'
import { buildRecipePrompt, imageProviders } from '../services/recipeImageGenerator.js'
import { imageFetchUrl } from '../services/recipeImageAudit.js'

const dish: Dish = { name: 'Tzatziki', ingredients: ['400 g yogur griego', '1 u pepino', '5 g menta'], steps: ['Ralla el pepino.'], meals: ['snack'] }
const v = (matchesDish: boolean, houseStyle: boolean): ImageVerdict => ({ matchesDish, houseStyle, reason: 'x' })

function deps(verdicts: Array<ImageVerdict | null>): HouseImageDeps & { generated: number } {
  const d = {
    generated: 0,
    describe: vi.fn(async () => 'Cuenco de yogur blanco espeso con pepino rallado y hojas de menta.'),
    generate: vi.fn(async () => Buffer.from(`img${++d.generated}`)),
    check: vi.fn(async () => verdicts.shift() ?? null),
  }
  return d
}

describe('makeHouseImage', () => {
  it('keeps the first image that passes the check', async () => {
    const d = deps([v(true, true)])
    const out = await makeHouseImage(dish, d)
    expect(out.png?.toString()).toBe('img1')
    expect(out.attempts).toBe(1)
    expect(d.generate).toHaveBeenCalledTimes(1)
  })

  it('tries once more on a miss and keeps the second if it passes', async () => {
    const out = await makeHouseImage(dish, deps([v(false, true), v(true, true)]))
    expect(out.png?.toString()).toBe('img2')
    expect(out.attempts).toBe(2)
  })

  it('falls back to an attempt that at least shows the right dish', async () => {
    const out = await makeHouseImage(dish, deps([v(true, false), v(false, false)]))
    expect(out.png?.toString()).toBe('img1')
  })

  it('saves nothing when no attempt shows the dish (a wrong dish misleads more than no photo)', async () => {
    const out = await makeHouseImage(dish, deps([v(false, true), v(false, true)]))
    expect(out.png).toBeNull()
    expect(out.verdict?.matchesDish).toBe(false)
  })

  it('accepts the first image when the checker is unavailable', async () => {
    const out = await makeHouseImage(dish, deps([null]))
    expect(out.png?.toString()).toBe('img1')
  })

  it('prompts with the visual description of the plated dish', async () => {
    const d = deps([v(true, true)])
    await makeHouseImage(dish, d)
    const prompt = (d.generate as any).mock.calls[0][0] as string
    expect(prompt).toMatch(/^Tzatziki\. Cuenco de yogur blanco espeso/)
    expect(prompt).toContain('Nada de perfección de estudio')
  })
})

describe('buildRecipePrompt', () => {
  it('uses the ingredient list when there is no description', () => {
    expect(buildRecipePrompt({ name: 'Lentejas', topIngredients: ['lentejas', 'chorizo'], meals: ['lunch'] })).toContain('Ingredientes principales visibles: lentejas, chorizo.')
  })
})

describe('isReplaceableImage', () => {
  const base = 'https://ona-api-production.up.railway.app/images/recipes'
  it('replaces nothing-yet and source thumbnails', () => {
    expect(isReplaceableImage(null, base)).toBe(true)
    expect(isReplaceableImage('https://i.ytimg.com/vi/abc/hqdefault.jpg', base)).toBe(true)
    expect(isReplaceableImage('https://i.blogs.es/x/receta.jpg', base)).toBe(true)
  })
  it('keeps our own: generated/uploaded on the volume, or a committed seed JPG', () => {
    expect(isReplaceableImage(`${base}/123.jpg`, base)).toBe(false)
    expect(isReplaceableImage('/images/recipes/tzatziki.jpg', base)).toBe(false)
  })
})

describe('imageProviders', () => {
  it("'auto' tries AiKit, then OpenAI (AiKit refuses API keys since 2026-10-08)", () => {
    expect(imageProviders('auto', { aikit: true, openai: true })).toEqual(['aikit', 'openai'])
    expect(imageProviders('auto', { aikit: false, openai: true })).toEqual(['openai'])
    expect(imageProviders('openai', { aikit: true, openai: true })).toEqual(['openai'])
    expect(imageProviders('aikit', { aikit: false, openai: true })).toEqual([])
  })
})

describe('vision check + describer', () => {
  it('normalizes the model verdict and rejects junk', () => {
    expect(normalizeVerdict({ matches_dish: true, house_style: false, reason: 'fondo oscuro' })).toEqual({ matchesDish: true, houseStyle: false, reason: 'fondo oscuro' })
    expect(normalizeVerdict({ matches_dish: 'yes' })).toBeNull()
    expect(normalizeVerdict(null)).toBeNull()
  })

  it('sends the image + recipe and parses a fenced JSON answer', async () => {
    const create = vi.fn(async () => ({
      content: [{ type: 'text', text: '```json\n{"matches_dish": false, "house_style": true, "reason": "son galletas"}\n```' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }))
    const verdict = await checkRecipeImage({ ...dish, image: Buffer.from('x'), mimeType: 'image/jpeg' }, { create: create as any })
    expect(verdict).toEqual({ matchesDish: false, houseStyle: true, reason: 'son galletas' })
    const content = (create.mock.calls[0] as any)[0].messages[0].content
    expect(content[0].type).toBe('image')
    expect(content[1].text).toContain('Tzatziki')
  })

  it('describer returns null when the model fails (generation goes on with ingredients)', async () => {
    const create = vi.fn(async () => {
      throw new Error('down')
    })
    expect(await describeDish(dish, { create: create as any })).toBeNull()
  })
})

describe('helpers', () => {
  it('dishLine writes amounts, skipping "al gusto"', () => {
    expect(dishLine({ name: 'ternera', quantity: 400, unit: 'g', note: 'para guisar' })).toBe('400 g ternera (para guisar)')
    expect(dishLine({ name: 'sal', quantity: 0, unit: 'al_gusto', note: null })).toBe('sal')
  })
  it('imageFetchUrl resolves seed paths against the web', () => {
    expect(imageFetchUrl('/images/recipes/x.jpg', 'https://mimoia.com/')).toBe('https://mimoia.com/images/recipes/x.jpg')
    expect(imageFetchUrl('https://i.ytimg.com/a.jpg', 'https://mimoia.com')).toBe('https://i.ytimg.com/a.jpg')
  })
})
