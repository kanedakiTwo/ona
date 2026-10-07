/**
 * Allergies and diets must actually exclude recipes. Before 2026-10-07 a
 * restriction only matched an ingredient with the identical name, so
 * "sin gluten", "vegetariano" or "frutos secos" excluded nothing.
 */
import { describe, expect, it } from 'vitest'
import { RESTRICTION_PRESETS } from '@ona/shared'
import {
  compileRestrictions,
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
      const meaningful = rules.allergens.size > 0 || rules.terms.length > 1
      expect(meaningful, preset).toBe(true)
    }
  })
})
