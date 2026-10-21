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
  effectiveAllergens,
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

describe('PRO-61 — gluten rules and effectiveAllergens', () => {
  it('harina de fuerza / salsa de soja carry gluten; gluten-free bases do not', () => {
    expect(inferAllergenTagsFromName('Harina de fuerza')).toEqual(['gluten'])
    expect(inferAllergenTagsFromName('salsa de soja')).toEqual(['gluten', 'soja'])
    expect(inferAllergenTagsFromName('tamari sin gluten')).toEqual(['soja'])
    expect(inferAllergenTagsFromName('harina de trigo sarraceno')).toEqual([])
    expect(inferAllergenTagsFromName('harina de arroz')).toEqual([])
  })

  it('effectiveAllergens adds what the names say and keeps stored tags', () => {
    expect(effectiveAllergens(['huevo', 'lactosa'], ['harina de fuerza', 'mozzarella'])).toEqual(['gluten', 'huevo', 'lactosa'])
    expect(effectiveAllergens(['sulfitos'], ['tomate'])).toEqual(['sulfitos'])
    expect(effectiveAllergens(null, [])).toEqual([])
    expect(effectiveAllergens(['inventado'], [])).toEqual([])
  })
})

describe('PRO-160 — peanut is matched by whole word', () => {
  it('does not tag words that merely contain «mani»', () => {
    for (const name of ['manitas de cerdo', 'Manitas', 'mandarina', 'manzana']) {
      expect(inferAllergenTagsFromName(name)).not.toContain('cacahuetes')
    }
  })

  it('still tags maní / cacahuete in any form', () => {
    for (const name of ['maní tostado', 'Maní', 'mani', 'cacahuetes', 'crema de cacahuete']) {
      expect(inferAllergenTagsFromName(name)).toContain('cacahuetes')
    }
  })

  it('still catches the compounds substring matching used to catch (panko, empanadilla, apionabo, salmonete)', () => {
    expect(inferAllergenTagsFromName('panko')).toContain('gluten')
    expect(inferAllergenTagsFromName('empanadilla')).toContain('gluten')
    expect(inferAllergenTagsFromName('apionabo')).toContain('apio')
    expect(inferAllergenTagsFromName('salmonete')).toContain('pescado')
  })

  it('effectiveAllergens does not add cacahuetes for «Manitas de cerdo»', () => {
    expect(effectiveAllergens([], ['Manitas de cerdo'])).not.toContain('cacahuetes')
  })
})

describe('PRO-193 — whole words, with explicit exceptions', () => {
  it('does not tag words that only contain a keyword', () => {
    expect(inferAllergenTagsFromName('panceta')).not.toContain('gluten')
    expect(inferAllergenTagsFromName('Panceta ahumada')).not.toContain('gluten')
    expect(inferAllergenTagsFromName('pasta de tomate')).not.toContain('gluten')
    expect(inferAllergenTagsFromName('leche de coco')).not.toContain('lactosa')
    expect(inferAllergenTagsFromName('nuez moscada')).not.toContain('frutos_secos')
    expect(inferAllergenTagsFromName('manitas de cerdo')).not.toContain('cacahuetes')
  })

  it('pastes and plant drinks keep the allergens they do have', () => {
    expect(inferAllergenTagsFromName('pasta de curry')).toEqual([])
    expect(inferAllergenTagsFromName('pasta de sésamo')).toEqual(['sesamo'])
    expect(inferAllergenTagsFromName('leche de almendra')).toEqual(['frutos_secos'])
    expect(inferAllergenTagsFromName('leche de avena')).toEqual(['gluten'])
    expect(inferAllergenTagsFromName('leche de coco y leche entera')).toContain('lactosa')
    expect(inferAllergenTagsFromName('nueces y nuez moscada')).toContain('frutos_secos')
  })

  it('keeps every tag that must be there', () => {
    for (const name of ['pan rallado', 'pan', 'panes de pita', 'pasta', 'pasta fresca', 'espaguetis', 'macarrones', 'galletas', 'rebozado', 'cerveza'])
      expect(inferAllergenTagsFromName(name), name).toContain('gluten')
    for (const name of ['leche', 'leche entera', 'leches', 'quesitos', 'natillas', 'yogures', 'mantequilla'])
      expect(inferAllergenTagsFromName(name), name).toContain('lactosa')
    for (const name of ['nueces', 'nuez', 'nueces de macadamia', 'almendras', 'avellanas', 'castañas'])
      expect(inferAllergenTagsFromName(name), name).toContain('frutos_secos')
    for (const name of ['cacahuete', 'cacahuetes', 'maní', 'mani'])
      expect(inferAllergenTagsFromName(name), name).toContain('cacahuetes')
    for (const name of ['calamares', 'mejillones', 'langostinos', 'pescadilla', 'sardinillas', 'boquerones'])
      expect(inferAllergenTagsFromName(name).length, name).toBeGreaterThan(0)
    expect(inferAllergenTagsFromName('vinagreta')).toContain('sulfitos')
  })

  it('the ficha (effectiveAllergens) no longer adds the wrong tags', () => {
    expect(effectiveAllergens([], ['Panceta', 'Manitas de cerdo', 'Nuez moscada', 'Leche de coco', 'Pasta de tomate'])).toEqual([])
  })
})

describe('Tandas libros-01 y yaya-01 (2026-10-21) — ingredientes nuevos que salían sin alérgeno', () => {
  it('almejas pequeñas, navajas y otros bivalvos son moluscos', () => {
    for (const name of ['chirlas', 'navajas', 'zamburiñas', 'coquinas', 'berberechos', 'bígaros', 'caracoles'])
      expect(inferAllergenTagsFromName(name), name).toEqual(['marisco', 'moluscos'])
  })

  it('galeras, carabineros, nécoras, centollos y percebes son crustáceos', () => {
    for (const name of ['galeras', 'carabineros', 'nécoras', 'centollo', 'percebes', 'buey de mar'])
      expect(inferAllergenTagsFromName(name), name).toEqual(['crustaceos', 'marisco'])
  })

  it('el dashi y el katsuobushi llevan pescado; también el cabracho y el mero', () => {
    for (const name of ['dashi en polvo', 'katsuobushi', 'cabracho', 'mero'])
      expect(inferAllergenTagsFromName(name), name).toContain('pescado')
  })

  it('el vino shaoxing y la salsa de ostras suelen llevar trigo; el shichimi, sésamo', () => {
    expect(inferAllergenTagsFromName('vino shaoxing')).toEqual(['gluten', 'sulfitos'])
    expect(inferAllergenTagsFromName('salsa de ostras')).toEqual(['gluten', 'marisco', 'moluscos'])
    expect(inferAllergenTagsFromName('shichimi togarashi')).toEqual(['sesamo'])
    expect(inferAllergenTagsFromName('salsa teriyaki')).toEqual(['gluten', 'soja'])
    expect(inferAllergenTagsFromName('salsa hoisin')).toEqual(['gluten', 'soja'])
  })

  it('no confunde la carne de buey ni otras palabras', () => {
    expect(inferAllergenTagsFromName('carne de buey')).toEqual([])
    expect(inferAllergenTagsFromName('caracolas de hojaldre')).not.toContain('moluscos')
  })
})
