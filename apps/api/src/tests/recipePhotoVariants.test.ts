/**
 * PRO-59 — variety in recipe photos. The prompt is a shared base plus a
 * variant (tableware × surface × angle × prop) picked stably per recipe,
 * and the house-style check accepts every variant. No image is generated.
 *
 * Run: pnpm --filter @ona/api test src/tests/recipePhotoVariants.test.ts
 */

import { describe, expect, it } from 'vitest'
import {
  buildRecipePrompt,
  PHOTO_VARIANTS,
  photoVariantFor,
  photoVariantText,
  STYLE_BASE,
} from '../services/recipeImageGenerator.js'
import { CHECK_PROMPT } from '../services/recipeImageCheck.js'

const NAMES = [
  'Lentejas con chorizo',
  'Tortilla de patatas',
  'Crema de calabaza',
  'Pollo al ajillo',
  'Ensalada de garbanzos',
  'Merluza en salsa verde',
  'Arroz con pollo',
  'Gazpacho andaluz',
  'Albóndigas en salsa',
  'Pisto manchego',
  'Macarrones con tomate',
  'Salmón al horno con patatas',
  'Fabada asturiana',
  'Croquetas de jamón',
  'Tzatziki',
  'Menestra de verduras',
  'Costillas a la riojana',
  'Bacalao a la vizcaína',
  'Porrusalda',
  'Huevos rotos con pimientos',
]

const mentionsSpoon = (text: string) => /cuchar/i.test(text)

describe('photoVariantFor', () => {
  it('the same recipe always gets the same variant (accents, case and spaces aside)', () => {
    for (const n of NAMES) expect(photoVariantFor(n)).toBe(photoVariantFor(n))
    expect(photoVariantFor('Albóndigas en salsa')).toBe(photoVariantFor('albondigas  en salsa'))
  })

  it('20 different recipes cover at least 5 variants', () => {
    const ids = new Set(NAMES.map((n) => photoVariantFor(n).id))
    expect(ids.size).toBeGreaterThanOrEqual(5)
  })

  it('no more than half of them carry a spoon', () => {
    const withSpoon = NAMES.filter((n) => mentionsSpoon(photoVariantText(photoVariantFor(n)))).length
    expect(withSpoon).toBeLessThanOrEqual(NAMES.length / 2)
  })

  it('the catalogue of variants: 6–8, distinct, and fewer than half with a spoon', () => {
    expect(PHOTO_VARIANTS.length).toBeGreaterThanOrEqual(6)
    expect(PHOTO_VARIANTS.length).toBeLessThanOrEqual(8)
    expect(new Set(PHOTO_VARIANTS.map((v) => v.id)).size).toBe(PHOTO_VARIANTS.length)
    expect(PHOTO_VARIANTS.filter((v) => mentionsSpoon(photoVariantText(v))).length).toBeLessThan(PHOTO_VARIANTS.length / 2)
    expect(PHOTO_VARIANTS.some((v) => v.prop === '')).toBe(true)
  })
})

describe('buildRecipePrompt', () => {
  it('includes the shared base and the recipe variant', () => {
    const prompt = buildRecipePrompt({ name: 'Lentejas con chorizo', topIngredients: ['lentejas'], meals: ['lunch'] })
    expect(prompt).toContain(STYLE_BASE)
    expect(prompt).toContain(photoVariantText(photoVariantFor('Lentejas con chorizo')))
    expect(prompt.startsWith('Lentejas con chorizo.')).toBe(true)
  })

  it('the base no longer pins a spoon, a linen or an angle', () => {
    expect(mentionsSpoon(STYLE_BASE)).toBe(false)
    expect(STYLE_BASE).not.toMatch(/lino|madera|desde arriba|tres cuartos/i)
  })

  it('variantSeed (e.g. the id) overrides the name', () => {
    const byName = buildRecipePrompt({ name: 'Tzatziki', topIngredients: [], meals: [] })
    const seed = NAMES.find((n) => photoVariantFor(n).id !== photoVariantFor('Tzatziki').id)!
    const bySeed = buildRecipePrompt({ name: 'Tzatziki', topIngredients: [], meals: [], variantSeed: seed })
    expect(bySeed).not.toBe(byName)
    expect(bySeed).toContain(photoVariantText(photoVariantFor(seed)))
  })
})

describe('house-style check accepts every variant', () => {
  const KEYWORDS: Array<[RegExp, string]> = [
    [/barro/, 'barro'],
    [/gres/, 'gres'],
    [/porcelana/, 'porcelana'],
    [/esmaltad/, 'esmaltada'],
    [/madera/, 'madera'],
    [/piedra/, 'piedra'],
    [/lino/, 'lino'],
    [/cuadros/, 'cuadros'],
    [/encimera/, 'encimera'],
    [/cenital|desde arriba/, 'desde arriba'],
    [/tres cuartos/, 'tres cuartos'],
    [/lateral/, 'lateral'],
  ]
  it.each(PHOTO_VARIANTS.map((v) => [v.id, v] as const))('%s', (_id, v) => {
    const text = `${v.tableware} ${v.surface} ${v.angle}`
    const hits = KEYWORDS.filter(([re]) => re.test(text))
    expect(hits.length, `variant ${v.id} names a material, a surface and an angle`).toBeGreaterThanOrEqual(3)
    for (const [, word] of hits) expect(CHECK_PROMPT, `check prompt accepts «${word}»`).toContain(word)
  })
})
