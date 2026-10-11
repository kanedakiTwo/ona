/**
 * PRO-30 — Instagram / TikTok links. Plan A: the post caption
 * (`og:description`). Plan B: "mándame una captura", never an invented recipe.
 * The page and the LLM are simulated; ingredient matching (DB) is mocked.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../services/recipeExtractor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/recipeExtractor.js')>()
  return {
    ...actual,
    matchIngredients: vi.fn(async (raw: { name: string; quantity: number; unit: string }[]) => ({
      matched: raw.map((r, i) => ({
        extractedName: r.name,
        ingredientId: `ing-${i}`,
        ingredientName: r.name,
        quantity: r.quantity,
        unit: r.unit,
        matched: true,
      })),
      warnings: [],
    })),
  }
})

import type { TextExtractionProvider, TextExtractionResult } from '../services/recipeExtractor.js'
import {
  extractRecipeFromUrl,
  SocialCaptionUnavailableError,
  SOCIAL_SCREENSHOT_MESSAGE,
} from '../services/recipeUrlExtractor.js'
import {
  decodeHtmlEntities,
  detectSocialPlatform,
  extractSocialCaption,
} from '../services/sources/social.js'
import { extractedToWriteInput } from '../services/recipeImport.js'
import { PageFetchError } from '../services/net/publicFetch.js'

const IG_URL = 'https://www.instagram.com/reel/C9abcDEF123/'
const TT_URL = 'https://www.tiktok.com/@cocinillas/video/7412345678901234567'

const RECIPE_CAPTION =
  'Lentejas con chorizo 🍲 Ingredientes (4 personas): 300 g de lentejas, 1 chorizo, 1 cebolla, 2 zanahorias, 1 diente de ajo. ' +
  'Pasos: 1. Sofríe la cebolla, el ajo y la zanahoria. 2. Añade el chorizo en rodajas. 3. Incorpora las lentejas y cubre con agua. 4. Cuece 40 minutos.'

function page(meta: Record<string, string>): string {
  const tags = Object.entries(meta)
    .map(([k, v]) => `<meta ${k.startsWith('og:') ? 'property' : 'name'}="${k}" content="${v}" />`)
    .join('\n')
  return `<!doctype html><html><head>${tags}</head><body><div id="app"></div></body></html>`
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

function recipeProvider(): TextExtractionProvider & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async extractRecipeFromText(text, hint): Promise<TextExtractionResult> {
      calls.push(`${hint}:${text}`)
      return {
        isRecipe: true,
        raw: {
          name: 'Lentejas con chorizo',
          servings: 4,
          servingsConfidence: 'explicit',
          prepTime: 10,
          cookTime: 40,
          difficulty: 'easy',
          ingredients: [
            { name: 'lenteja', quantity: 300, unit: 'g' },
            { name: 'chorizo', quantity: 1, unit: 'u' },
          ],
          steps: ['Sofríe la cebolla.', 'Añade el chorizo.', 'Cuece 40 minutos.'],
          suggestedMeals: ['lunch'],
          suggestedSeasons: ['autumn', 'winter'],
          tags: [],
        },
      }
    },
  }
}

describe('detectSocialPlatform', () => {
  it('recognises Instagram and TikTok hosts (incl. short links)', () => {
    expect(detectSocialPlatform(IG_URL)).toBe('instagram')
    expect(detectSocialPlatform('https://instagram.com/p/abc/')).toBe('instagram')
    expect(detectSocialPlatform(TT_URL)).toBe('tiktok')
    expect(detectSocialPlatform('https://vm.tiktok.com/ZMabc123/')).toBe('tiktok')
  })
  it('leaves YouTube, blogs and look-alike hosts alone', () => {
    expect(detectSocialPlatform('https://youtu.be/abc')).toBeNull()
    expect(detectSocialPlatform('https://www.directoalpaladar.com/receta')).toBeNull()
    expect(detectSocialPlatform('https://instagram.com.evil.example/p/x')).toBeNull()
    expect(detectSocialPlatform('no es una url')).toBeNull()
  })
})

describe('extractSocialCaption', () => {
  it('reads og:description and decodes entities', () => {
    const html = page({ 'og:description': escapeAttr('Tortilla "de la abuela" & más') })
    expect(extractSocialCaption(html)).toBe('Tortilla "de la abuela" & más')
  })

  it("strips Instagram's likes/comments/author prefix", () => {
    const html = page({
      'og:description': escapeAttr(`1,234 likes, 56 comments - cocinillas on October 1, 2026: "${RECIPE_CAPTION}"`),
    })
    expect(extractSocialCaption(html)).toBe(RECIPE_CAPTION)
  })

  it('prefers the longest of og:description / description / twitter:description', () => {
    const html = page({ 'og:description': 'Lentejas con chorizo…', description: escapeAttr(RECIPE_CAPTION) })
    expect(extractSocialCaption(html)).toBe(RECIPE_CAPTION)
  })

  it('returns null when the page has no description at all', () => {
    expect(extractSocialCaption('<html><head><title>Instagram</title></head></html>')).toBeNull()
  })

  it('decodes numeric entities', () => {
    expect(decodeHtmlEntities('Jam&#243;n &#x1F372; &amp; pan')).toBe('Jamón 🍲 & pan')
  })
})

describe('extractRecipeFromUrl — Instagram / TikTok', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Instagram: a caption with the recipe becomes a recipe with sourceUrl (→ «Ver fuente»)', async () => {
    const provider = recipeProvider()
    const html = page({
      'og:title': 'Cocinillas on Instagram',
      'og:description': escapeAttr(`1,234 likes, 56 comments - cocinillas on October 1, 2026: "${RECIPE_CAPTION}"`),
      'og:image': 'https://scontent.cdninstagram.com/v/lentejas.jpg',
    })
    const out = await extractRecipeFromUrl(IG_URL, { provider, fetchSocial: async () => html })

    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0]).toMatch(/^social:/)
    expect(provider.calls[0]).toContain('Sofríe la cebolla')
    expect(out.name).toBe('Lentejas con chorizo')
    expect(out.sourceUrl).toBe(IG_URL)
    expect(out.sourceType).toBe('article')
    expect(out.imageUrl).toBe('https://scontent.cdninstagram.com/v/lentejas.jpg')
    const write = extractedToWriteInput(out, { internalTags: ['auto-extracted', 'from-url'] })
    expect(write.sourceUrl).toBe(IG_URL)
    expect(write.ingredients).toHaveLength(2)
  })

  it('TikTok: same path from the og:description caption', async () => {
    const provider = recipeProvider()
    const html = page({ 'og:description': escapeAttr(RECIPE_CAPTION) })
    const out = await extractRecipeFromUrl(TT_URL, { provider, fetchSocial: async () => html })
    expect(out.sourceUrl).toBe(TT_URL)
    expect(out.steps.length).toBeGreaterThan(0)
  })

  it('TikTok without a caption: asks for a screenshot and never calls the LLM', async () => {
    const provider = recipeProvider()
    const html = page({ 'og:description': 'Receta en el vídeo 👀 #receta #fyp' })
    const err = await extractRecipeFromUrl(TT_URL, { provider, fetchSocial: async () => html }).catch((e) => e)
    expect(err).toBeInstanceOf(SocialCaptionUnavailableError)
    expect(err.message).toBe('No he podido leer la receta de este vídeo; mándame una captura')
    expect(err.message).toBe(SOCIAL_SCREENSHOT_MESSAGE)
    expect(provider.calls).toHaveLength(0)
  })

  it('Instagram login wall / HTTP error: same screenshot answer', async () => {
    const provider = recipeProvider()
    const err = await extractRecipeFromUrl(IG_URL, {
      provider,
      fetchSocial: async () => {
        throw new PageFetchError('La página respondió con un error (429).')
      },
    }).catch((e) => e)
    expect(err).toBeInstanceOf(SocialCaptionUnavailableError)
  })

  it('a long caption that is not a recipe ("receta en mi bio"): screenshot, nothing invented', async () => {
    const provider: TextExtractionProvider = {
      async extractRecipeFromText() {
        return { isRecipe: false, reason: 'El pie remite a la bio' }
      },
    }
    const html = page({ 'og:description': escapeAttr('Las mejores lentejas de mi vida, ¡no te lo pierdas! La receta completa está en el enlace de mi bio, corre a verla 🔥🔥 #lentejas') })
    await expect(extractRecipeFromUrl(IG_URL, { provider, fetchSocial: async () => html })).rejects.toBeInstanceOf(
      SocialCaptionUnavailableError,
    )
  })

  it('ingredients without steps (steps "in the video"): screenshot, not a half recipe', async () => {
    const provider: TextExtractionProvider = {
      async extractRecipeFromText() {
        const r = await recipeProvider().extractRecipeFromText('', 'social')
        if (!r.isRecipe) throw new Error('unreachable')
        return { isRecipe: true, raw: { ...r.raw, steps: [] } }
      },
    }
    const html = page({ 'og:description': escapeAttr(RECIPE_CAPTION) })
    await expect(extractRecipeFromUrl(TT_URL, { provider, fetchSocial: async () => html })).rejects.toBeInstanceOf(
      SocialCaptionUnavailableError,
    )
  })
})
