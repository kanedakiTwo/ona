/**
 * PRO-196 — cured meats and gluten (Miguel, 2026-10-18, answer B).
 *
 * The catalogue drops the prudence `gluten` tag from chorizo, morcilla,
 * butifarras, salchichas, foie and jamón de york (migration
 * 0072_embutidos_sin_gluten.sql); a coeliac household gets lentejas con
 * chorizo again and sees «Chorizo oreado sin gluten» on the list and «Elige
 * embutido sin gluten» on the recipe. A household without coeliac disease
 * sees neither.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ShoppingItem } from '@ona/shared'
import { compileRestrictions, violatesRestrictions } from '../services/dietaryRestrictions.js'
import {
  CHOOSE_GLUTEN_FREE_CHARCUTERIE,
  isBrandDependentGlutenBlendOrStock,
  isBrandDependentGlutenCharcuterie,
  isCoeliacHousehold,
  needsGlutenFreeLabel,
  recipeDietNotices,
  withGlutenFreeCharcuterieNames,
} from '../services/glutenFreeCharcuterie.js'

const LENTEJAS = ['lentejas', 'chorizo oreado', 'morcilla de cebolla', 'zanahoria', 'cebolla', 'pimentón dulce']

const lentejas = (chorizoTags: string[]) => ({
  name: 'Lentejas con chorizo',
  allergens: [],
  ingredients: LENTEJAS.map((n) => ({ ingredientName: n, allergenTags: n.startsWith('chorizo') || n.startsWith('morcilla') ? chorizoTags : [] })),
})

const item = (name: string, kind: ShoppingItem['kind'] = 'menu'): ShoppingItem => ({
  id: name,
  ingredientId: kind === 'menu' ? `id-${name}` : null,
  name,
  quantity: 1,
  unit: 'u',
  aisle: 'proteinas',
  checked: false,
  inStock: false,
  kind,
})

describe('coeliac household and lentejas con chorizo', () => {
  const coeliac = ['Sin gluten']
  const other = ['vegetariano']

  it('gets the recipe once the brand-dependent tag is gone (and not with it)', () => {
    const rules = compileRestrictions(coeliac)
    expect(violatesRestrictions(lentejas(['gluten']), rules)).toBe(true)
    expect(violatesRestrictions(lentejas([]), rules)).toBe(false)
  })

  it('sees both notices; a household without coeliac disease sees none', () => {
    expect(isCoeliacHousehold(coeliac)).toBe(true)
    expect(isCoeliacHousehold(['Celiaquía'])).toBe(true)
    expect(isCoeliacHousehold(other)).toBe(false)
    expect(isCoeliacHousehold([])).toBe(false)

    expect(recipeDietNotices(LENTEJAS, isCoeliacHousehold(coeliac))).toEqual([CHOOSE_GLUTEN_FREE_CHARCUTERIE])
    expect(CHOOSE_GLUTEN_FREE_CHARCUTERIE).toBe('Elige embutido sin gluten')
    expect(recipeDietNotices(LENTEJAS, isCoeliacHousehold(other))).toEqual([])
    expect(recipeDietNotices(['lentejas', 'zanahoria'], true)).toEqual([])

    const list = [item('chorizo oreado'), item('lentejas'), item('jamón de york')]
    expect(withGlutenFreeCharcuterieNames(list, true).map((i) => i.name)).toEqual([
      'chorizo oreado sin gluten',
      'lentejas',
      'jamón de york sin gluten',
    ])
    expect(withGlutenFreeCharcuterieNames(list, false).map((i) => i.name)).toEqual(['chorizo oreado', 'lentejas', 'jamón de york'])
  })

  it('keeps the user\'s own words (staples, manual items) and the ids', () => {
    const out = withGlutenFreeCharcuterieNames([item('chorizo', 'staple'), item('salchichas', 'manual'), item('morcilla de cebolla')], true)
    expect(out.map((i) => i.name)).toEqual(['chorizo', 'salchichas', 'morcilla de cebolla sin gluten'])
    expect(out[2].id).toBe('morcilla de cebolla')
  })
})

// PRO-1063 (Dani y Sara, 2026-10-27): the chili of the gluten-free menu asked
// for «chili en polvo» with no notice; only Mimo, if asked, said «mirad la
// etiqueta». Blends and stocks now get it on the recipe and the list.
describe('blended spices and stocks in a coeliac household', () => {
  const CHILI = ['carne picada de ternera', 'alubias rojas cocidas', 'tomate triturado', 'Chili en polvo', 'comino molido']

  it('the chili tells a coeliac household to pick gluten-free chili en polvo', () => {
    expect(recipeDietNotices(CHILI, true)).toEqual(['Elige chili en polvo sin gluten'])
    expect(recipeDietNotices(CHILI, false)).toEqual([])
    expect(recipeDietNotices(CHILI.filter((n) => n !== 'Chili en polvo'), true)).toEqual([])
  })

  it('one notice per blend or stock line, after the cured meat one, without repeats', () => {
    const arroz = ['arroz', 'chorizo oreado', 'Caldo de pollo', 'curry en polvo', 'caldo de pollo', 'garbanzos cocidos']
    expect(recipeDietNotices(arroz, true)).toEqual([
      CHOOSE_GLUTEN_FREE_CHARCUTERIE,
      'Elige caldo de pollo sin gluten',
      'Elige curry en polvo sin gluten',
    ])
  })

  it('chili en polvo, curry, ras el hanout and stocks in a cube or a brick', () => {
    for (const n of ['chili en polvo', 'chile en polvo', 'curry', 'curry en polvo', 'pasta de curry amarillo', 'ras el hanout', 'caldo de verduras', 'caldo de pollo', 'caldo de pescado', 'caldo de cocido', 'pastilla de caldo', 'cubitos de caldo', 'fumet']) {
      expect(isBrandDependentGlutenBlendOrStock(n), n).toBe(true)
      expect(needsGlutenFreeLabel(n), n).toBe(true)
    }
  })

  it('not single spices, the bones for a stock at home or what already says «sin gluten»', () => {
    for (const n of ['comino molido', 'pimentón dulce', 'cayena', 'chile fresco', 'huesos para caldo', 'caldo de verduras sin gluten', 'arroz']) {
      expect(isBrandDependentGlutenBlendOrStock(n), n).toBe(false)
    }
  })

  it('the list asks for them «sin gluten» like the chorizo', () => {
    const list = [item('Caldo de verduras'), item('Chili en polvo'), item('chorizo oreado'), item('comino molido'), item('caldo de pollo', 'manual')]
    expect(withGlutenFreeCharcuterieNames(list, true).map((i) => i.name)).toEqual([
      'Caldo de verduras sin gluten',
      'Chili en polvo sin gluten',
      'chorizo oreado sin gluten',
      'comino molido',
      'caldo de pollo',
    ])
  })
})

describe('which cured meats depend on the brand', () => {
  it('chorizo, morcilla, butifarras, salchichas, foie, jamón de york…', () => {
    for (const n of ['Chorizo oreado', 'morcilla de cebolla', 'butifarra blanca', 'Butifarra negra', 'salchichas frescas', 'foie gras de untar', 'jamón de york', 'paté de campaña', 'fuet', 'sobrasada']) {
      expect(isBrandDependentGlutenCharcuterie(n), n).toBe(true)
    }
  })

  it('not the cocido leftovers, a stock, plain meat, jamón serrano or what already says «sin gluten»', () => {
    for (const n of ['sobras del cocido madrileño', 'caldo de cocido', 'panceta', 'jamón serrano', 'lentejas', 'chorizo sin gluten']) {
      expect(isBrandDependentGlutenCharcuterie(n), n).toBe(false)
    }
  })

  it('the data migration only touches names the notices cover, never the cocido leftovers', () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations')
    const file = readdirSync(dir).find((f) => f.endsWith('_embutidos_sin_gluten.sql'))
    expect(file).toBeTruthy()
    const sql = readFileSync(path.join(dir, file!), 'utf8')
    const names = [...sql.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((n) => n !== 'gluten')
    expect(new Set(names)).toEqual(
      new Set(['chorizo oreado', 'morcilla de cebolla', 'butifarra blanca', 'butifarra negra', 'salchichas frescas', 'foie gras de untar', 'jamón de york']),
    )
    for (const n of names) expect(isBrandDependentGlutenCharcuterie(n), n).toBe(true)
    expect(sql).not.toMatch(/sobras/)
  })
})
