import { describe, expect, it } from 'vitest'
import {
  extractOgImage,
  parseIngredientString,
  parseJsonLdRecipe,
  parseSchemaImage,
} from '../services/sources/article.js'

const wrap = (json: object | string) => `
<!doctype html>
<html><head>
  <script type="application/ld+json">${
    typeof json === 'string' ? json : JSON.stringify(json)
  }</script>
</head><body><h1>Recipe</h1></body></html>`

describe('parseJsonLdRecipe', () => {
  it('parses a flat Recipe schema with strings + arrays', () => {
    const html = wrap({
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      name: 'Tortilla de patatas',
      recipeYield: '4',
      prepTime: 'PT10M',
      cookTime: 'PT20M',
      recipeIngredient: ['4 huevos', '2 patatas medianas', 'aceite de oliva'],
      recipeInstructions: [
        'Pela y corta las patatas en rodajas finas.',
        'Fríelas a fuego medio en abundante aceite.',
        'Bate los huevos y mézclalos con las patatas.',
      ],
    })
    const out = parseJsonLdRecipe(html)
    expect(out).not.toBeNull()
    expect(out!.name).toBe('Tortilla de patatas')
    expect(out!.servings).toBe(4)
    expect(out!.prepTime).toBe(10)
    expect(out!.cookTime).toBe(20)
    expect(out!.ingredients.length).toBe(3)
    expect(out!.steps.length).toBe(3)
    expect(out!.steps[0]).toContain('patatas')
  })

  it('parses HowToStep objects in recipeInstructions', () => {
    const html = wrap({
      '@type': 'Recipe',
      name: 'Paella',
      recipeIngredient: ['arroz', 'pollo', 'verduras'],
      recipeInstructions: [
        { '@type': 'HowToStep', text: 'Sofríe el pollo.' },
        { '@type': 'HowToStep', text: 'Añade el arroz y el caldo.' },
      ],
    })
    const out = parseJsonLdRecipe(html)
    expect(out).not.toBeNull()
    expect(out!.steps).toEqual(['Sofríe el pollo.', 'Añade el arroz y el caldo.'])
  })

  it('finds a Recipe inside @graph', () => {
    const html = wrap({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: 'Página' },
        {
          '@type': 'Recipe',
          name: 'Gazpacho',
          recipeIngredient: ['tomate', 'pepino', 'pimiento'],
          recipeInstructions: ['Tritura todo'],
        },
      ],
    })
    const out = parseJsonLdRecipe(html)
    expect(out).not.toBeNull()
    expect(out!.name).toBe('Gazpacho')
  })

  it('handles HowToSection with nested itemListElement', () => {
    const html = wrap({
      '@type': 'Recipe',
      name: 'Lasaña',
      recipeIngredient: ['pasta', 'carne'],
      recipeInstructions: [
        {
          '@type': 'HowToSection',
          name: 'Preparar la masa',
          itemListElement: [
            { '@type': 'HowToStep', text: 'Hierve la pasta.' },
            { '@type': 'HowToStep', text: 'Escúrrela.' },
          ],
        },
        {
          '@type': 'HowToSection',
          itemListElement: [{ '@type': 'HowToStep', text: 'Hornea 30 min.' }],
        },
      ],
    })
    const out = parseJsonLdRecipe(html)
    expect(out!.steps).toEqual(['Hierve la pasta.', 'Escúrrela.', 'Hornea 30 min.'])
  })

  it('returns null when there is no Recipe schema', () => {
    const html = wrap({ '@type': 'Article', headline: 'No es receta' })
    expect(parseJsonLdRecipe(html)).toBeNull()
  })

  it('returns null on malformed JSON inside the script tag', () => {
    const html = wrap('not-json{[')
    expect(parseJsonLdRecipe(html)).toBeNull()
  })

  it('parses ISO 8601 durations with hours', () => {
    const html = wrap({
      '@type': 'Recipe',
      name: 'Estofado',
      prepTime: 'PT1H30M',
      cookTime: 'PT2H',
      recipeIngredient: ['carne'],
      recipeInstructions: ['Cuece despacio'],
    })
    const out = parseJsonLdRecipe(html)
    expect(out!.prepTime).toBe(90)
    expect(out!.cookTime).toBe(120)
  })

  it('returns null when HTML has no JSON-LD script tags', () => {
    expect(
      parseJsonLdRecipe('<html><body>Just text, no JSON-LD</body></html>'),
    ).toBeNull()
  })
})

describe('parseIngredientString', () => {
  it('parses joined "<num><unit> <name>" (directoalpaladar style)', () => {
    expect(parseIngredientString('450g Fabes de La Granja')).toEqual({
      name: 'fabes de la granja',
      quantity: 450,
      unit: 'g',
    })
  })

  it('treats "count" as unit u (whole-piece count)', () => {
    expect(parseIngredientString('2count Chorizo asturiano')).toEqual({
      name: 'chorizo asturiano',
      quantity: 2,
      unit: 'u',
    })
    expect(parseIngredientString('1count Laurel')).toEqual({
      name: 'laurel',
      quantity: 1,
      unit: 'u',
    })
  })

  it('parses spaced "<num> <unit> <name>" with grams', () => {
    expect(parseIngredientString('200 g Lacón')).toEqual({
      name: 'lacón',
      quantity: 200,
      unit: 'g',
    })
  })

  it('parses ml + l with conversion to ml', () => {
    expect(parseIngredientString('250 ml leche')).toEqual({
      name: 'leche',
      quantity: 250,
      unit: 'ml',
    })
    expect(parseIngredientString('1 l caldo')).toEqual({
      name: 'caldo',
      quantity: 1000,
      unit: 'ml',
    })
  })

  it('parses kg with conversion to grams', () => {
    expect(parseIngredientString('1.5 kg pollo')).toEqual({
      name: 'pollo',
      quantity: 1500,
      unit: 'g',
    })
  })

  it('treats unitless counted items as unit u', () => {
    expect(parseIngredientString('2 dientes de ajo')).toEqual({
      name: 'dientes de ajo',
      quantity: 2,
      unit: 'u',
    })
    expect(parseIngredientString('1 cebolla')).toEqual({
      name: 'cebolla',
      quantity: 1,
      unit: 'u',
    })
  })

  it('falls back gracefully when there is no quantity', () => {
    expect(parseIngredientString('aceite de oliva virgen')).toEqual({
      name: 'aceite de oliva virgen',
      quantity: 0,
      unit: 'al_gusto',
    })
  })

  it('handles fractional quantities written with comma', () => {
    expect(parseIngredientString('1,5 cucharadas de sal')).toEqual({
      name: 'sal',
      quantity: 1.5,
      unit: 'cda',
    })
  })

  it('handles cucharada / cucharadita variants', () => {
    expect(parseIngredientString('1 cucharadita de azúcar').unit).toBe('cdita')
    expect(parseIngredientString('2 cdas aceite').unit).toBe('cda')
    expect(parseIngredientString('1 cda. vinagre').unit).toBe('cda')
  })
})

describe('parseSchemaImage', () => {
  it('accepts a plain string URL', () => {
    expect(parseSchemaImage('https://example.com/hero.jpg')).toBe(
      'https://example.com/hero.jpg',
    )
  })

  it('accepts an ImageObject with .url', () => {
    expect(parseSchemaImage({ url: 'https://example.com/x.jpg', '@type': 'ImageObject' })).toBe(
      'https://example.com/x.jpg',
    )
  })

  it('picks the first usable entry from an array', () => {
    expect(
      parseSchemaImage([
        { '@type': 'ImageObject' }, // no url
        'https://example.com/second.jpg',
      ]),
    ).toBe('https://example.com/second.jpg')
  })

  it('rejects non-http schemes and empty strings', () => {
    expect(parseSchemaImage('data:image/png;base64,abc')).toBeNull()
    expect(parseSchemaImage('')).toBeNull()
    expect(parseSchemaImage(undefined)).toBeNull()
    expect(parseSchemaImage(null)).toBeNull()
  })

  it('flows through parseJsonLdRecipe so importer hits image_url', () => {
    const html = wrap({
      '@type': 'Recipe',
      name: 'Lentejas',
      image: ['https://blog.com/lentejas.jpg'],
      recipeIngredient: ['200 g lentejas'],
      recipeInstructions: ['Cocer 30 min.'],
    })
    const recipe = parseJsonLdRecipe(html)
    expect(recipe?.imageUrl).toBe('https://blog.com/lentejas.jpg')
  })
})

describe('extractOgImage', () => {
  it('matches og:image with property attribute', () => {
    const html = `<html><head><meta property="og:image" content="https://blog.com/og.jpg"></head></html>`
    expect(extractOgImage(html)).toBe('https://blog.com/og.jpg')
  })

  it('matches og:image with the attribute order reversed (content before property)', () => {
    const html = `<html><head><meta content="https://blog.com/og.jpg" property="og:image"></head></html>`
    expect(extractOgImage(html)).toBe('https://blog.com/og.jpg')
  })

  it('falls back to twitter:image when og:image is absent', () => {
    const html = `<html><head><meta name="twitter:image" content="https://blog.com/tw.jpg"></head></html>`
    expect(extractOgImage(html)).toBe('https://blog.com/tw.jpg')
  })

  it('falls back to <link rel="image_src">', () => {
    const html = `<html><head><link rel="image_src" href="https://blog.com/legacy.jpg"></head></html>`
    expect(extractOgImage(html)).toBe('https://blog.com/legacy.jpg')
  })

  it('returns null when no meta is present', () => {
    expect(extractOgImage('<html><head></head></html>')).toBeNull()
  })

  it('rejects relative or non-http URLs', () => {
    const html = `<html><head><meta property="og:image" content="/relative.jpg"></head></html>`
    expect(extractOgImage(html)).toBeNull()
  })
})
