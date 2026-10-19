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
  isBrandDependentGlutenCharcuterie,
  isCoeliacHousehold,
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
