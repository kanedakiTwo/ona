/**
 * Recipe pages whose schema.org/Recipe JSON-LD is an empty shell (name +
 * image, `recipeIngredient: [""]`, `HowToStep` with `text: ""`) — the
 * Rank Math output on casanoguera.com. The recipe lives in the article body,
 * so the importer must read the text instead of saving an empty recipe
 * (2026-11-02: «Recepta de botifarra amb seques» landed with 0 ingredients
 * and 0 steps, and then couldn't be edited). The page and the LLM are
 * simulated; ingredient matching (DB) is mocked.
 */
import { describe, expect, it, vi } from 'vitest'

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

import type {
  RawExtractedRecipe,
  TextExtractionProvider,
  TextExtractionResult,
} from '../services/recipeExtractor.js'
import { extractArticleRecipe } from '../services/sources/article.js'
import { extractRecipeFromUrl, NeedsScreenshotError } from '../services/recipeUrlExtractor.js'
import { NoExtractableContentError } from '../services/sources/youtube.js'

const URL = 'https://www.casanoguera.com/ca/recepta-botifarra-amb-seques/'
const IMAGE = 'https://www.casanoguera.com/wp-content/uploads/2018/09/botifarra-amb-seques.jpg'

// The JSON-LD block exactly as the site emits it.
const HOLLOW_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Recepta de botifarra amb seques',
  image: { '@type': 'ImageObject', url: IMAGE, width: 1000, height: 664 },
  author: { '@type': 'Organization', name: 'Casa Noguera' },
  description: '',
  prepTime: '',
  cookTime: '',
  recipeYield: '',
  recipeIngredient: [''],
  recipeInstructions: [{ '@type': 'HowToStep', text: '' }],
}

const ARTICLE_BODY = `
  <h1>Recepta de botifarra amb seques</h1>
  <p>Bé, no ens enganyem. Ens l'estimem molt, però no és que sigui la recepta més complicada del món.
  Per nosaltres, com sempre, el secret està en escollir els millors ingredients.</p>
  <h2>Ingredients per a cada persona</h2>
  <ul>
    <li>1 botifarra crua tradicional.</li>
    <li>200gr de mongetes blanques. A nosaltres ens pirren la varietat del Ganxet.</li>
    <li>All i julivert picats.</li>
    <li>Pebre vermell dolç (opcional).</li>
    <li>Una pinça de sal.</li>
  </ul>
  <h2>Procés</h2>
  <ol>
    <li>Passa les botifarres per la planxa o fes-les a la brasa fins que quedin torradetes per fora i tendres per dins.</li>
    <li>En una paella salteja les mongetes. Pots comprar-les cuites o coure-les tu mateix abans.</li>
    <li>Quan estiguin quasi a punt, afegeix a la paella la picada d'all i julivert.</li>
    <li>Afegeix un rajolí d'oli d'oliva i un xic de sal i salteja uns dos minuts.</li>
  </ol>`

function page(jsonLd: object): string {
  return `<!doctype html><html><head>
    <meta property="og:image" content="https://www.casanoguera.com/og.jpg" />
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  </head><body><article>${ARTICLE_BODY}</article></body></html>`
}

const LLM_RECIPE: RawExtractedRecipe = {
  name: 'Butifarra con judías',
  servings: 1,
  servingsConfidence: 'explicit',
  prepTime: 5,
  cookTime: 15,
  difficulty: 'easy',
  ingredients: [
    { name: 'butifarra', quantity: 1, unit: 'u' },
    { name: 'judía blanca cocida', quantity: 200, unit: 'g' },
    { name: 'ajo', quantity: 1, unit: 'u' },
    { name: 'perejil', quantity: 5, unit: 'g' },
  ],
  steps: [
    'Haz la butifarra a la plancha o a la brasa.',
    'Saltea las judías en una sartén.',
    'Añade el ajo y el perejil picados.',
  ],
  suggestedMeals: ['lunch', 'dinner'],
  suggestedSeasons: ['autumn', 'winter'],
  tags: [],
}

function provider(result: TextExtractionResult): TextExtractionProvider & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async extractRecipeFromText(text): Promise<TextExtractionResult> {
      calls.push(text)
      return result
    },
  }
}

describe('extractArticleRecipe — empty JSON-LD shell', () => {
  it('reads the article text when the JSON-LD has no ingredients or steps', async () => {
    const llm = provider({ isRecipe: true, raw: LLM_RECIPE })
    const out = await extractArticleRecipe(URL, {
      provider: llm,
      fetchArticle: async () => page(HOLLOW_JSON_LD),
    })

    expect(llm.calls).toHaveLength(1)
    expect(llm.calls[0]).toContain('mongetes blanques')
    expect(out.isRecipe).toBe(true)
    if (!out.isRecipe) return
    expect(out.raw.ingredients.map((i) => i.name)).toContain('butifarra')
    expect(out.raw.steps).toHaveLength(3)
    // The JSON-LD image still wins over og:image.
    expect(out.raw.imageUrl).toBe(IMAGE)
  })

  it('reads the article text when the JSON-LD lists ingredients but no steps', async () => {
    const llm = provider({ isRecipe: true, raw: LLM_RECIPE })
    const out = await extractArticleRecipe(URL, {
      provider: llm,
      fetchArticle: async () =>
        page({ ...HOLLOW_JSON_LD, recipeIngredient: ['1 butifarra', '200 g judías blancas'] }),
    })

    expect(llm.calls).toHaveLength(1)
    expect(out.isRecipe && out.raw.steps).toHaveLength(3)
  })

  it('still uses a complete JSON-LD directly, without calling the LLM', async () => {
    const llm = provider({ isRecipe: true, raw: LLM_RECIPE })
    const out = await extractArticleRecipe(URL, {
      provider: llm,
      fetchArticle: async () =>
        page({
          ...HOLLOW_JSON_LD,
          recipeIngredient: ['1 butifarra', '200 g judías blancas'],
          recipeInstructions: [{ '@type': 'HowToStep', text: 'Haz la butifarra a la plancha.' }],
        }),
    })

    expect(llm.calls).toHaveLength(0)
    expect(out.isRecipe && out.raw.name).toBe('Recepta de botifarra amb seques')
    expect(out.isRecipe && out.raw.steps).toEqual(['Haz la butifarra a la plancha.'])
  })
})

describe('extractArticleRecipe — a page we are not let in to read', () => {
  // What casanoguera.com (SiteGround) answered the production server on
  // 2026-11-03: an anti-bot redirect, no recipe in it.
  const BOT_WALL =
    '<html><head><link rel="icon" href="data:;"><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2Fca%2Frecepta-botifarra-amb-seques%2F&y=ipc:208.77.244.82:1793697277.873"></meta></head></html>'

  it('asks for a screenshot instead of calling it "not a recipe"', async () => {
    const llm = provider({ isRecipe: true, raw: LLM_RECIPE })
    const run = extractArticleRecipe(URL, { provider: llm, fetchArticle: async () => BOT_WALL })

    await expect(run).rejects.toBeInstanceOf(NeedsScreenshotError)
    await expect(run).rejects.toThrow(/mándame una captura/)
    expect(llm.calls).toHaveLength(0)
  })
})

describe('extractRecipeFromUrl — never an empty recipe', () => {
  it('imports the botifarra page with its ingredients and steps', async () => {
    const out = await extractRecipeFromUrl(URL, {
      provider: provider({ isRecipe: true, raw: LLM_RECIPE }),
      fetchArticle: async () => page(HOLLOW_JSON_LD),
    })

    expect(out.ingredients).toHaveLength(4)
    expect(out.steps).toHaveLength(3)
    expect(out.sourceUrl).toBe(URL)
  })

  it('refuses with a clear message when no ingredients come out', async () => {
    const run = extractRecipeFromUrl(URL, {
      provider: provider({ isRecipe: true, raw: { ...LLM_RECIPE, ingredients: [] } }),
      fetchArticle: async () => page(HOLLOW_JSON_LD),
    })

    await expect(run).rejects.toBeInstanceOf(NoExtractableContentError)
    await expect(run).rejects.toThrow(/ingredientes/)
  })

  it('refuses when no steps come out', async () => {
    const run = extractRecipeFromUrl(URL, {
      provider: provider({ isRecipe: true, raw: { ...LLM_RECIPE, steps: [] } }),
      fetchArticle: async () => page(HOLLOW_JSON_LD),
    })

    await expect(run).rejects.toBeInstanceOf(NoExtractableContentError)
  })
})
