/**
 * "¿Se puede comprar esta receta?" — the BUY_* lint warnings
 * (services/recipeShoppability.ts). Cases are rows found in the
 * 2026-10-08 audit of the production catalogue.
 */
import { describe, it, expect } from 'vitest'
import { toOrderQty } from '@ona/shared'
import { shoppabilityIssues, type ShoppableRow } from '../services/recipeShoppability.js'
import { lintRecipe, type RecipeInput } from '../services/recipeLint.js'

const row = (name: string, quantity: number, unit: ShoppableRow['unit'], extra: Partial<ShoppableRow> = {}): ShoppableRow => ({ name, quantity, unit, ...extra })
const codes = (rows: ShoppableRow[]) => shoppabilityIssues(rows).map((i) => i.code)

describe('BUY_NO_QUANTITY', () => {
  it('flags things you have to buy that go "al gusto" (they never reach the list)', () => {
    const issues = shoppabilityIssues([row('cilantro', 0, 'al_gusto'), row('mozzarella', 0, 'al_gusto'), row('alcachofa', 0, 'pizca')])
    expect(issues.map((i) => i.code)).toEqual(['BUY_NO_QUANTITY', 'BUY_NO_QUANTITY', 'BUY_NO_QUANTITY'])
    expect(issues[0].message).toContain('1 manojo de cilantro')
  })

  it('flags a zero amount in grams too ("pan seco de algarroba 0 g")', () => {
    expect(codes([row('pan seco de algarroba', 0, 'g')])).toEqual(['BUY_NO_QUANTITY'])
  })

  it('leaves pantry basics alone: sal, pimienta, aceite, orégano al gusto are assumed at home', () => {
    expect(codes([row('sal', 0, 'al_gusto'), row('pimienta negra', 1, 'pizca'), row('aceite de oliva virgen extra', 0, 'al_gusto'), row('oregano', 0, 'g')])).toEqual([])
  })

  it('leaves optional rows alone', () => {
    expect(codes([row('perejil', 0, 'al_gusto', { optional: true })])).toEqual([])
  })
})

describe('BUY_GENERIC', () => {
  it('a family list must be split into products', () => {
    const [issue] = shoppabilityIssues([row('hierbas aromáticas (romero, tomillo)', 2, 'u')])
    expect(issue.code).toBe('BUY_GENERIC')
    expect(issue.message).toContain('romero o tomillo')
  })

  it('a name that leaves the species open must pick one', () => {
    expect(codes([row('pescado entero fresco (dorada, lubina, gallo, etc.)', 1, 'u')])).toEqual(['BUY_GENERIC'])
    expect(codes([row('dorada', 2, 'u')])).toEqual([])
  })
})

describe('BUY_NEEDS_CHOICE', () => {
  it('"ternera" with no cut makes the order wait for "¿para qué?"', () => {
    const [issue] = shoppabilityIssues([row('ternera', 400, 'g')])
    expect(issue.code).toBe('BUY_NEEDS_CHOICE')
    expect(issue.message).toContain('picada, en filetes o para guisar')
  })

  it('a note that names the cut resolves it', () => {
    expect(codes([row('ternera', 400, 'g', { note: 'para guisar, en dados' })])).toEqual([])
    expect(codes([row('ternera', 400, 'g', { note: 'carrilleras' })])).toEqual([])
    expect(codes([row('cordero', 600, 'g', { note: 'carne para guisar, en taquitos grandes' })])).toEqual([])
    expect(codes([row('jamon', 50, 'g', { note: 'serrano, en taquitos' })])).toEqual([])
    expect(codes([row('pan blanco', 50, 'g', { note: 'en barra, remojado en leche' })])).toEqual([])
    expect(codes([row('carne de aguja', 125, 'g', { note: 'de ternera, picada' })])).toEqual([])
  })

  it('does not repeat options the question already names', () => {
    const [issue] = shoppabilityIssues([row('jamon', 50, 'g')])
    expect(issue.message).toContain('¿Serrano o ibérico?')
    expect(issue.message).not.toContain('(serrano o ibérico)')
  })
})

describe('BUY_NEEDS_WEIGHT', () => {
  it('meat counted in units has to say grams', () => {
    expect(codes([row('panceta', 2, 'u')])).toEqual(['BUY_NEEDS_WEIGHT'])
    expect(codes([row('panceta', 100, 'g')])).toEqual([])
  })
})

describe('buy rules added with the audit', () => {
  it('carrilleras, bacalao desmigado and aguja de ternera reach the shop as such', () => {
    expect(toOrderQty({ name: 'ternera', quantity: 400, unit: 'g', notes: ['carrilleras'] }).text).toBe('medio kilo de carrilleras de ternera')
    expect(toOrderQty({ name: 'bacalao', quantity: 400, unit: 'g', notes: ['desmigado'] }).text).toBe('medio kilo de bacalao desalado desmigado')
    expect(toOrderQty({ name: 'carne de aguja', quantity: 250, unit: 'g', notes: ['de ternera, picada'] }).text).toBe('un cuarto de kilo de aguja de ternera, picada')
    expect(toOrderQty({ name: 'aguja de cerdo', quantity: 500, unit: 'g' }).text).toBe('medio kilo de aguja de cerdo')
  })
})

describe('lintRecipe carries the BUY_* warnings (never errors)', () => {
  it('on the ingredient path, and the recipe still saves', () => {
    const recipe: RecipeInput = {
      name: 'Ensalada thai',
      servings: 2,
      meals: ['lunch'],
      equipment: ['bol'],
      ingredients: [
        { id: 'r1', ingredientId: 'c-lechuga', quantity: 200, unit: 'g' },
        { id: 'r2', ingredientId: 'c-cilantro', quantity: 0, unit: 'al_gusto' },
      ],
      steps: [{ index: 0, text: 'Mezcla la lechuga con el cilantro.', ingredientRefs: ['r1', 'r2'] }],
    }
    const result = lintRecipe(recipe, {
      ingredientCatalog: [
        { id: 'c-lechuga', name: 'lechuga', fdcId: 1 },
        { id: 'c-cilantro', name: 'cilantro', fdcId: 2 },
      ],
    })
    expect(result.ok).toBe(true)
    expect(result.warnings.find((w) => w.code === 'BUY_NO_QUANTITY')).toMatchObject({ path: 'ingredients[1]' })
  })
})
