import { describe, expect, it } from 'vitest'
import { edibleFractionForName } from '../services/nutrition/edibleFraction.js'
import { auditCatalogRecipe, lineGrams } from '../services/catalogRecipeAudit.js'

describe('edibleFractionForName (PRO-194)', () => {
  it('gives bone-in cuts their edible share', () => {
    expect(edibleFractionForName('Gallina')).toBe(0.7)
    expect(edibleFractionForName('pollo entero')).toBe(0.68)
    expect(edibleFractionForName('muslo de pollo')).toBe(0.7)
    expect(edibleFractionForName('Alitas de pollo')).toBe(0.54)
    expect(edibleFractionForName('alas de pavo')).toBe(0.6)
    expect(edibleFractionForName('costillas de cerdo')).toBe(0.7)
    expect(edibleFractionForName('Chuletón')).toBe(0.85)
    expect(edibleFractionForName('manitas de cerdo')).toBe(0.5)
    expect(edibleFractionForName('rabo de toro')).toBe(0.5)
    expect(edibleFractionForName('conejo entero')).toBe(0.73)
  })

  it('leaves boneless cuts, stocks and «conejo» (meat weight per unit) alone', () => {
    for (const n of ['conejo', 'pechuga de pollo', 'pollo', 'contramuslos deshuesados', 'caldo de pollo', 'carne de costilla', 'ternera', 'chuletas sin hueso'])
      expect(edibleFractionForName(n), n).toBeNull()
  })
})

describe('edibleFractionForName — piezas de las tandas libros-01 y yaya-01 (2026-10-21)', () => {
  it('la codorniz en singular, la perdiz, el cuello de cordero y el «ossobuco» con doble s llevan hueso', () => {
    expect(edibleFractionForName('codorniz')).toBe(0.65)
    expect(edibleFractionForName('codornices')).toBe(0.65)
    expect(edibleFractionForName('perdiz')).toBe(0.65)
    expect(edibleFractionForName('perdices')).toBe(0.65)
    expect(edibleFractionForName('cuello de cordero')).toBe(0.6)
    expect(edibleFractionForName('ossobuco de ternera')).toBe(0.8)
  })

  it('sin hueso, nada', () => {
    expect(edibleFractionForName('pechuga de perdiz')).toBeNull()
    expect(edibleFractionForName('magret')).toBeNull()
  })
})

describe('catalogue audit with a bone-in cut (PRO-194)', () => {
  it('counts the edible grams, so a stew with a whole chicken is no longer «proteína fuera de rango»', () => {
    const base = {
      name: 'Escudella de prueba',
      servings: 4,
      stepCount: 5,
      ingredients: [
        { name: 'pollo entero', quantity: 1350, unit: 'g' },
        { name: 'garbanzos', quantity: 300, unit: 'g' },
        { name: 'patata', quantity: 400, unit: 'g' },
      ],
    }
    expect(auditCatalogRecipe(base).issues).toContain('proteina_fuera_de_rango') // 338 g per serving with the bone
    const withBone = { ...base, ingredients: base.ingredients.map((i) => (i.name === 'pollo entero' ? { ...i, edibleFraction: 0.68 } : i)) }
    const r = auditCatalogRecipe(withBone)
    expect(r.proteinPerServingG).toBe(230)
    expect(r.issues).not.toContain('proteina_fuera_de_rango')
  })

  it('lineGrams applies the fraction to units too', () => {
    expect(lineGrams({ name: 'manitas de cerdo', quantity: 5, unit: 'u', unitWeight: 300, edibleFraction: 0.5 })).toBe(750)
    expect(lineGrams({ name: 'ternera', quantity: 200, unit: 'g' })).toBe(200)
  })
})

describe('edibleFractionForName — pescado entero y marisco con concha (PRO-281)', () => {
  it('da su merma al pescado entero y al marisco con su concha o cáscara', () => {
    expect(edibleFractionForName('mejillones')).toBe(0.28)
    expect(edibleFractionForName('Mejillón')).toBe(0.28)
    expect(edibleFractionForName('mejillones con concha')).toBe(0.28)
    for (const n of ['almejas', 'berberechos', 'chirlas', 'almejas con concha']) expect(edibleFractionForName(n), n).toBe(0.18)
    for (const n of ['gambas', 'langostinos', 'cigalas', 'gambas enteras', 'langostinos con cáscara']) expect(edibleFractionForName(n), n).toBe(0.48)
    for (const n of ['dorada', 'lubina', 'besugo', 'doradas', 'pescado entero', 'pescado blanco entero']) expect(edibleFractionForName(n), n).toBe(0.5)
  })

  it('nunca cuando el nombre dice que ya es la parte comestible', () => {
    for (const n of [
      'gambas peladas', 'langostinos congelados pelados', 'mejillones sin concha', 'carne de mejillón',
      'mejillones en escabeche', 'almejas en conserva', 'almejas al natural', 'berberechos en lata',
      'lomos de lubina', 'filetes de dorada', 'dorada limpia', 'gambas sin cáscara', 'pescado blanco',
      'caldo de pescado', 'fumet de marisco',
    ])
      expect(edibleFractionForName(n), n).toBeNull()
  })
})

describe('edibleFractionForName — huesos para caldo (PRO-282)', () => {
  it('los huesos que solo dan sabor al caldo cuentan 0, aunque el nombre diga «caldo»', () => {
    for (const n of ['huesos para caldo', 'hueso de jamón', 'hueso de rodilla', 'hueso de caña o morcillo', 'espinazo de cerdo', 'carcasa de pollo', 'carcasas de gallina', 'cartílago de ternera', 'espinas de pescado'])
      expect(edibleFractionForName(n), n).toBe(0)
  })

  it('el caldo hecho con huesos no es un hueso', () => {
    expect(edibleFractionForName('caldo de huesos')).toBeNull()
    expect(edibleFractionForName('fondo de huesos')).toBeNull()
    expect(edibleFractionForName('jamón serrano')).toBeNull()
  })
})
