/**
 * Allergies and diets must actually exclude recipes. Before 2026-10-07 a
 * restriction only matched an ingredient with the identical name, so
 * "sin gluten", "vegetariano" or "frutos secos" excluded nothing.
 */
import { describe, expect, it } from 'vitest'
import { RESTRICTION_PRESETS } from '@ona/shared'
import {
  compileRestrictions,
  hasMilkAllergy,
  mergeRestrictions,
  nameHasAlcohol,
  nameHasTerm,
  restrictionKey,
  violatesRestrictions,
  type RestrictableRecipe,
} from '../services/dietaryRestrictions.js'

const recipe = (names: string[], allergens: string[] = [], tags: Record<string, string[]> = {}): RestrictableRecipe => ({
  allergens,
  ingredients: names.map((n) => ({ ingredientName: n, allergenTags: tags[n] ?? [] })),
})

const blocks = (restrictions: string[], r: RestrictableRecipe, dislikes: string[] = []) =>
  violatesRestrictions(r, compileRestrictions(restrictions, dislikes))

describe('restrictionKey', () => {
  it.each([
    ['Sin gluten', 'gluten'],
    ['sin lácteos', 'lacteos'],
    ['Alergia a los frutos secos', 'frutos secos'],
    ['soy intolerante a la lactosa', 'lactosa'],
    ['no como cerdo', 'cerdo'],
    ['  VEGANO ', 'vegano'],
  ])('%s → %s', (input, key) => {
    expect(restrictionKey(input)).toBe(key)
  })
})

describe('allergies', () => {
  it('"sin gluten" excludes wheat flour, pasta and bread (by tag, by recipe union, or by name)', () => {
    expect(blocks(['sin gluten'], recipe(['harina de trigo', 'agua']))).toBe(true)
    expect(blocks(['sin gluten'], recipe(['espaguetis'], ['gluten']))).toBe(true)
    expect(blocks(['sin gluten'], recipe(['fideos chinos'], [], { 'fideos chinos': ['gluten'] }))).toBe(true)
    expect(blocks(['sin gluten'], recipe(['arroz', 'pollo', 'pimiento']))).toBe(false)
  })

  it('"sin lactosa" / "sin lacteos" exclude dairy', () => {
    expect(blocks(['sin lactosa'], recipe(['queso parmesano']))).toBe(true)
    expect(blocks(['sin lacteos'], recipe(['nata para cocinar']))).toBe(true)
    expect(blocks(['sin lactosa'], recipe(['aceite de oliva', 'tomate']))).toBe(false)
  })

  it('"frutos secos" also covers peanuts', () => {
    expect(blocks(['frutos secos'], recipe(['almendras laminadas']))).toBe(true)
    expect(blocks(['frutos secos'], recipe(['crema de cacahuete']))).toBe(true)
  })

  it('"marisco" covers crustaceans and molluscs', () => {
    expect(blocks(['marisco'], recipe(['gambas']))).toBe(true)
    expect(blocks(['mariscos'], recipe(['mejillones']))).toBe(true)
    expect(blocks(['marisco'], recipe(['merluza']))).toBe(false)
  })

  it('huevo / soja / pescado', () => {
    expect(blocks(['huevo'], recipe(['huevos camperos']))).toBe(true)
    expect(blocks(['soja'], recipe(['tofu firme']))).toBe(true)
    expect(blocks(['pescado'], recipe(['lomo de salmón']))).toBe(true)
  })
})

describe('diets', () => {
  it('vegetariano excludes meat and fish but keeps eggs and dairy', () => {
    for (const meat of ['pechuga de pollo', 'jamón serrano', 'carne picada', 'chorizo', 'atún en lata', 'caldo de pollo']) {
      expect(blocks(['vegetariano'], recipe([meat])), meat).toBe(true)
    }
    expect(blocks(['vegetariano'], recipe(['huevo', 'queso', 'espinacas', 'garbanzos']))).toBe(false)
  })

  it('vegano also excludes eggs, dairy and honey', () => {
    expect(blocks(['vegano'], recipe(['huevo']))).toBe(true)
    expect(blocks(['vegano'], recipe(['mantequilla']))).toBe(true)
    expect(blocks(['vegano'], recipe(['miel']))).toBe(true)
    expect(blocks(['vegano'], recipe(['lentejas', 'zanahoria', 'tofu']))).toBe(false)
  })

  it('sin cerdo excludes pork products only', () => {
    expect(blocks(['sin cerdo'], recipe(['panceta']))).toBe(true)
    expect(blocks(['sin cerdo'], recipe(['pollo']))).toBe(false)
  })

  it('does not trip on look-alike words', () => {
    expect(blocks(['vegetariano'], recipe(['pico de gallo', 'patatas', 'zapallo']))).toBe(false)
  })
})

describe('free text and dislikes', () => {
  it('matches whole words, accent/case-insensitive, plural-tolerant', () => {
    expect(nameHasTerm('cebolla morada', 'cebolla')).toBe(true)
    expect(nameHasTerm('cebollas', 'cebolla')).toBe(true)
    expect(nameHasTerm('cebollino', 'cebolla')).toBe(false)
    expect(blocks(['Cilantro'], recipe(['cilantro fresco']))).toBe(true)
    expect(blocks([], recipe(['Pimientos rojos']), ['pimiento'])).toBe(true)
    expect(blocks([], recipe(['pimienta negra']), ['pimiento'])).toBe(false)
  })

  it('no restrictions → nothing excluded', () => {
    expect(blocks([], recipe(['harina de trigo', 'jamón']))).toBe(false)
  })
})

describe('presets offered in onboarding and profile', () => {
  it('every preset compiles to a real rule (never a no-op exact-name match)', () => {
    for (const preset of RESTRICTION_PRESETS) {
      const rules = compileRestrictions([preset])
      const meaningful = rules.allergens.size > 0 || rules.terms.length > 1 || rules.alcohol
      expect(meaningful, preset).toBe(true)
    }
  })
})

describe('PRO-61 — prudent rules (Miguel, 2026-10-12)', () => {
  it('cuts, offal and cocido count as meat for a vegetarian', () => {
    for (const meat of [
      'Costillas', 'costillas adobadas', 'Sobras del cocido madrileño', 'caldo de cocido', 'Cocido',
      'rabo', 'oreja de cerdo', 'riñones', 'morcillo', 'hueso de caña', 'cuarto de gallina', 'entraña',
      'Salsa worcestershire', 'corvina',
    ]) {
      expect(blocks(['vegetariano'], recipe([meat])), meat).toBe(true)
    }
  })

  it('…without tripping on vegetarian words', () => {
    for (const ok of ['garbanzos cocidos', 'arroz cocido', 'aceitunas sin hueso', 'huevos de gallina camperos', 'orejones', 'tartar de aguacate']) {
      expect(blocks(['vegetariano'], recipe([ok])), ok).toBe(false)
    }
  })

  it('«sin gluten»: flours unless a gluten-free base, soy sauce unless «sin gluten»', () => {
    for (const g of ['Harina de fuerza', 'harina', 'harina integral', 'Salsa de soja', 'tamari', 'fideos', 'cerveza']) {
      expect(blocks(['sin gluten'], recipe([g])), g).toBe(true)
    }
    for (const ok of [
      'harina de arroz', 'harina de maíz', 'harina de garbanzo', 'harina de almendra',
      'harina de trigo sarraceno', 'harina de mandioca', 'harina sin gluten', 'tamari sin gluten',
      'salsa de soja sin gluten', 'fideos de arroz', 'soja texturizada', 'tofu',
    ]) {
      expect(blocks(['sin gluten'], recipe([ok])), ok).toBe(false)
    }
  })
})

describe('PRO-144 — «sin alcohol»', () => {
  it('excludes every alcoholic drink, also the wine of a sofrito', () => {
    for (const a of [
      'vino blanco', 'Vino tinto', 'vino de jerez', 'Jerez seco', 'cerveza', 'sidra natural', 'brandy', 'coñac',
      'licor de naranja', 'ron añejo', 'ron', 'Oporto', 'vermut rojo', 'cava brut', 'whisky', 'mirin', 'sake',
      'cerveza sin alcohol', 'un chorrito de vino',
    ]) {
      expect(blocks(['sin alcohol'], recipe(['cebolla', a])), a).toBe(true)
    }
  })

  it('matches whole words: «ron» and «cava» don\'t hit look-alikes, vinegars and yeast don\'t count', () => {
    for (const ok of [
      'ronqueta', 'cavar', 'excavado', 'cavallo', 'pimienta de cayena', 'vinagre de vino', 'Vinagre de vino blanco',
      'vinagre de Jerez', 'vinagre de sidra', 'vinagreta', 'levadura de cerveza', 'uva', 'vinagre balsámico de Módena',
      'toronja', 'cerezas', 'caviar', 'lirón', 'turrón',
    ]) {
      expect(nameHasAlcohol(ok.normalize('NFD').replace(/\p{Diacritic}+/gu, '').toLowerCase()), ok).toBe(false)
      expect(blocks(['sin alcohol'], recipe([ok])), ok).toBe(false)
    }
  })

  it('reads the recipe name too («Carrilleras de ternera con vino tinto», «Riñones al jerez»)', () => {
    expect(blocks(['sin alcohol'], { ...recipe(['ternera', 'cebolla']), name: 'Carrilleras de ternera con vino tinto' })).toBe(true)
    expect(blocks(['sin alcohol'], { ...recipe(['riñones']), name: 'Riñones al jerez' })).toBe(true)
    expect(blocks(['sin alcohol'], { ...recipe(['garbanzos']), name: 'Garbanzos con vinagre de Jerez' })).toBe(false)
    // Without the restriction the name changes nothing.
    expect(blocks(['sin gluten'], { ...recipe(['riñones']), name: 'Riñones al jerez' })).toBe(false)
  })

  it('understands how people say it', () => {
    for (const r of ['sin alcohol', 'Sin alcohol', 'nada de alcohol', 'cocinamos siempre sin alcohol', 'sin bebidas alcohólicas']) {
      expect(compileRestrictions([r]).alcohol, r).toBe(true)
      expect(blocks([r], recipe(['vino blanco'])), r).toBe(true)
    }
    expect(compileRestrictions(['sin gluten']).alcohol).toBe(false)
  })

  it('halal shares the rule (pork + alcohol, but not wine vinegar)', () => {
    expect(blocks(['halal'], recipe(['vino blanco']))).toBe(true)
    expect(blocks(['halal'], recipe(['panceta']))).toBe(true)
    expect(blocks(['halal'], recipe(['vinagre de vino']))).toBe(false)
  })
})

/**
 * PRO-312 (Seguridad, Legal 2026-10-21): allergy to milk is not «sin
 * lactosa». The EU allergen is «leche y sus derivados (incluida la lactosa)»:
 * lactose-free dairy still carries milk protein.
 */
describe('PRO-312 — leche (alergia) vs sin lactosa', () => {
  it('the chip «leche (alergia)» is offered next to «sin lactosa»', () => {
    expect(RESTRICTION_PRESETS).toContain('sin lactosa')
    expect(RESTRICTION_PRESETS).toContain('leche (alergia)')
  })

  it.each(['leche (alergia)', 'aplv', 'APLV', 'leche', 'proteína de leche', 'proteína de la leche de vaca', 'alergia a la leche', 'soy alérgica a la leche'])(
    '«%s» is the milk allergy',
    (r) => expect(hasMilkAllergy([r])).toBe(true),
  )

  it.each(['sin lactosa', 'intolerancia a la lactosa', 'lactosa', 'sin lácteos', 'leche de avena', 'vegano'])('«%s» is not the milk allergy', (r) => {
    expect(hasMilkAllergy([r])).toBe(false)
  })

  it('the menu filter takes out every dairy for the milk allergy, lactose-free ones included', () => {
    for (const dairy of [
      'leche entera', 'leche sin lactosa', 'nata sin lactosa', 'queso rallado sin lactosa', 'yogur natural sin lactosa',
      'mantequilla', 'kéfir', 'ghee', 'queso gouda', 'gouda', 'burrata', 'Emmental rallado', 'bechamel', 'caseinato cálcico',
    ]) {
      expect(blocks(['leche (alergia)'], recipe([dairy])), dairy).toBe(true)
      expect(blocks(['aplv'], recipe([dairy])), dairy).toBe(true)
    }
    // A lactose-free product tagged without «lactosa» in the catalogue still goes.
    expect(blocks(['leche (alergia)'], recipe(['leche sin lactosa'], [], { 'leche sin lactosa': [] }))).toBe(true)
  })

  it('plant drinks and dairy-free swaps stay for the milk allergy', () => {
    for (const ok of ['bebida de avena', 'leche de coco', 'leche de soja', 'aceite de oliva virgen extra', 'calabaza', 'pisto manchego']) {
      expect(blocks(['leche (alergia)'], recipe([ok])), ok).toBe(false)
    }
  })

  it('«sin lactosa» still takes out ordinary dairy (unchanged)', () => {
    expect(blocks(['sin lactosa'], recipe(['leche entera']))).toBe(true)
    expect(blocks(['sin lactosa'], recipe(['queso manchego curado']))).toBe(true)
  })

  it('«(alergia)» after any allergen is the allergen; both chips coexist when merged', () => {
    expect(restrictionKey('leche (alergia)')).toBe('leche')
    expect(restrictionKey('Marisco (alergia)')).toBe('marisco')
    expect(compileRestrictions(['marisco (alergia)']).allergens.has('crustaceos')).toBe(true)
    expect(mergeRestrictions(['sin lactosa', 'leche (alergia)'])).toEqual(['sin lactosa', 'leche (alergia)'])
  })
})
