/**
 * Unit tests for allergen helpers.
 *
 * Run: pnpm --filter @ona/api test
 *  or: cd apps/api && npx vitest run src/tests/nutritionAllergens.test.ts
 */

import { describe, it, expect } from 'vitest'
import {
  ALLERGEN_TAGS,
  allergenUnion,
  inferAllergenTagsFromName,
} from '../services/nutrition/allergens.js'

// ─── allergenUnion ─────────────────────────────────────────────

describe('allergenUnion', () => {
  it('returns the deduped, sorted union of catalog tags', () => {
    const catalog = new Map<string, { allergenTags?: string[] | null }>([
      ['a', { allergenTags: ['lactosa', 'gluten'] }],
      ['b', { allergenTags: ['gluten', 'huevo'] }],
      ['c', { allergenTags: ['huevo'] }],
    ])
    const result = allergenUnion(
      [
        { ingredientId: 'a' },
        { ingredientId: 'b' },
        { ingredientId: 'c' },
      ],
      catalog,
    )
    expect(result).toEqual(['gluten', 'huevo', 'lactosa'])
  })

  it('includes optional ingredients (caller passes them all)', () => {
    // The helper has no `optional` flag — callers pass the full list.
    // Verify the helper itself does not filter anything out.
    const catalog = new Map<string, { allergenTags?: string[] | null }>([
      ['main', { allergenTags: ['gluten'] }],
      ['opt', { allergenTags: ['frutos_secos'] }],
    ])
    const result = allergenUnion(
      [{ ingredientId: 'main' }, { ingredientId: 'opt' }],
      catalog,
    )
    expect(result).toEqual(['frutos_secos', 'gluten'])
  })

  it('returns [] for a recipe whose ingredients carry no tags', () => {
    const catalog = new Map<string, { allergenTags?: string[] | null }>([
      ['a', { allergenTags: [] }],
      ['b', { allergenTags: null }],
      ['c', {}],
    ])
    const result = allergenUnion(
      [
        { ingredientId: 'a' },
        { ingredientId: 'b' },
        { ingredientId: 'c' },
      ],
      catalog,
    )
    expect(result).toEqual([])
  })

  it('ignores unmapped ingredients silently', () => {
    const catalog = new Map<string, { allergenTags?: string[] | null }>([
      ['a', { allergenTags: ['gluten'] }],
    ])
    const result = allergenUnion(
      [{ ingredientId: 'a' }, { ingredientId: 'unknown' }],
      catalog,
    )
    expect(result).toEqual(['gluten'])
  })

  it('drops unknown tag strings (only emits canonical tags)', () => {
    const catalog = new Map<string, { allergenTags?: string[] | null }>([
      ['a', { allergenTags: ['gluten', 'not-a-real-tag', 'GLUTEN'] }],
    ])
    const result = allergenUnion([{ ingredientId: 'a' }], catalog)
    expect(result).toEqual(['gluten'])
  })

  it('returns a result whose entries are all in ALLERGEN_TAGS', () => {
    const catalog = new Map<string, { allergenTags?: string[] | null }>([
      ['a', { allergenTags: [...ALLERGEN_TAGS] } as { allergenTags: string[] }],
    ])
    const result = allergenUnion([{ ingredientId: 'a' }], catalog)
    expect(result).toHaveLength(ALLERGEN_TAGS.length)
    for (const tag of result) expect(ALLERGEN_TAGS).toContain(tag)
  })
})

// ─── inferAllergenTagsFromName ─────────────────────────────────

describe('inferAllergenTagsFromName — staple-collapse rules', () => {
  it('detects gluten from "harina de trigo"', () => {
    expect(inferAllergenTagsFromName('harina de trigo')).toEqual(['gluten'])
  })

  it('detects gluten from "pan rallado"', () => {
    expect(inferAllergenTagsFromName('pan rallado')).toEqual(['gluten'])
  })

  it('detects gluten from "pasta integral"', () => {
    expect(inferAllergenTagsFromName('pasta integral')).toEqual(['gluten'])
  })

  it('detects gluten from each cereal keyword', () => {
    for (const kw of ['cebada', 'centeno', 'avena', 'espelta', 'kamut', 'cuscús', 'bulgur', 'seitán']) {
      const tags = inferAllergenTagsFromName(kw)
      expect(tags, `expected gluten for "${kw}"`).toContain('gluten')
    }
  })

  it('detects lactosa from each dairy keyword', () => {
    for (const kw of [
      'leche entera',
      'queso manchego',
      'yogur natural',
      'mantequilla',
      'nata para cocinar',
      'crema agria',
      'requesón',
      'mascarpone',
      'parmesano',
      'mozzarella fresca',
      'feta',
      'cuajada',
    ]) {
      const tags = inferAllergenTagsFromName(kw)
      expect(tags, `expected lactosa for "${kw}"`).toContain('lactosa')
    }
  })

  it('detects huevo from "huevo", "huevos", "clara", "yema"', () => {
    expect(inferAllergenTagsFromName('huevo')).toEqual(['huevo'])
    expect(inferAllergenTagsFromName('huevos camperos')).toEqual(['huevo'])
    expect(inferAllergenTagsFromName('clara de huevo')).toEqual(['huevo'])
    expect(inferAllergenTagsFromName('yema')).toEqual(['huevo'])
  })

  it('detects frutos_secos for tree nuts', () => {
    for (const kw of ['almendra', 'nuez', 'avellana', 'pistacho', 'anacardo', 'pecana', 'nuez de macadamia', 'castaña', 'frutos secos']) {
      const tags = inferAllergenTagsFromName(kw)
      expect(tags, `expected frutos_secos for "${kw}"`).toContain('frutos_secos')
    }
  })

  it('detects cacahuetes from "cacahuete" and "maní"', () => {
    expect(inferAllergenTagsFromName('cacahuete')).toEqual(['cacahuetes'])
    expect(inferAllergenTagsFromName('maní tostado')).toEqual(['cacahuetes'])
  })

  it('detects soja from common soy keywords', () => {
    for (const kw of ['soja', 'tofu', 'tempeh', 'edamame', 'salsa de soja', 'tamari', 'miso']) {
      const tags = inferAllergenTagsFromName(kw)
      expect(tags, `expected soja for "${kw}"`).toContain('soja')
    }
  })

  it('detects pescado generically and per-species', () => {
    expect(inferAllergenTagsFromName('pescado blanco')).toContain('pescado')
    for (const kw of ['salmón', 'bacalao', 'atún', 'merluza', 'lubina', 'dorada', 'caballa', 'sardina', 'boquerón', 'anchoa', 'trucha']) {
      const tags = inferAllergenTagsFromName(kw)
      expect(tags, `expected pescado for "${kw}"`).toContain('pescado')
    }
  })

  it('detects crustaceos AND marisco for shellfish', () => {
    for (const kw of ['gamba', 'langostino', 'cigala', 'langosta', 'cangrejo', 'bogavante']) {
      const tags = inferAllergenTagsFromName(kw)
      expect(tags, `expected crustaceos for "${kw}"`).toContain('crustaceos')
      expect(tags, `expected marisco for "${kw}"`).toContain('marisco')
    }
  })

  it('detects moluscos AND marisco for cephalopods/bivalves', () => {
    for (const kw of ['mejillón', 'almeja', 'berberecho', 'pulpo', 'calamar', 'sepia', 'chipirón', 'vieira', 'ostra']) {
      const tags = inferAllergenTagsFromName(kw)
      expect(tags, `expected moluscos for "${kw}"`).toContain('moluscos')
      expect(tags, `expected marisco for "${kw}"`).toContain('marisco')
    }
  })

  it('detects apio, mostaza, sesamo, altramuces', () => {
    expect(inferAllergenTagsFromName('apio')).toEqual(['apio'])
    expect(inferAllergenTagsFromName('mostaza dijon')).toEqual(['mostaza'])
    expect(inferAllergenTagsFromName('sésamo tostado')).toEqual(['sesamo'])
    expect(inferAllergenTagsFromName('tahini')).toEqual(['sesamo'])
    expect(inferAllergenTagsFromName('altramuz')).toEqual(['altramuces'])
    expect(inferAllergenTagsFromName('altramuces')).toEqual(['altramuces'])
  })

  it('detects sulfitos for vino and vinagre', () => {
    expect(inferAllergenTagsFromName('vino tinto')).toEqual(['sulfitos'])
    expect(inferAllergenTagsFromName('vinagre de jerez')).toEqual(['sulfitos'])
  })

  it('returns the result deduped and alphabetically sorted', () => {
    // "gambas con almendras" → crustaceos + marisco + frutos_secos
    const result = inferAllergenTagsFromName('gambas con almendras')
    expect(result).toEqual(['crustaceos', 'frutos_secos', 'marisco'])
  })

  it('returns [] for a fully unknown ingredient', () => {
    expect(inferAllergenTagsFromName('quinoa')).toEqual([])
    expect(inferAllergenTagsFromName('tomate')).toEqual([])
    expect(inferAllergenTagsFromName('aceite de oliva virgen extra')).toEqual([])
  })

  it('is case-insensitive: "Salmón" → ["pescado"]', () => {
    expect(inferAllergenTagsFromName('Salmón')).toEqual(['pescado'])
  })

  it('is accent- and case-insensitive: "ALMENDRA" → ["frutos_secos"]', () => {
    expect(inferAllergenTagsFromName('ALMENDRA')).toEqual(['frutos_secos'])
  })

  it('handles empty / whitespace input', () => {
    expect(inferAllergenTagsFromName('')).toEqual([])
    expect(inferAllergenTagsFromName('   ')).toEqual([])
  })

  it('only emits tags from ALLERGEN_TAGS', () => {
    const samples = [
      'harina de trigo',
      'leche desnatada',
      'huevos camperos',
      'almendras',
      'cacahuetes',
      'salsa de soja',
      'salmón',
      'gambas',
      'mejillones',
      'apio rallado',
      'mostaza',
      'tahini',
      'altramuces',
      'vino blanco',
    ]
    for (const s of samples) {
      const tags = inferAllergenTagsFromName(s)
      for (const t of tags) {
        expect(ALLERGEN_TAGS, `unexpected tag "${t}" from "${s}"`).toContain(t)
      }
    }
  })
})
