/**
 * PRO-1115: the name of an ingredient line against the library, without AI:
 * «✓», «¿cuál?» (up to 3) or «nuevo».
 */
import { describe, it, expect } from 'vitest'
import { matchIngredientName, singularName } from '../services/ingredientLineMatch.js'

const CATALOG = [
  { id: '1', name: 'lentejas' },
  { id: '2', name: 'cebolla' },
  { id: '3', name: 'aceite de oliva' },
  { id: '4', name: 'aceite de girasol' },
  { id: '5', name: 'pimentón dulce' },
  { id: '6', name: 'pimentón picante' },
  { id: '7', name: 'sal' },
  { id: '8', name: 'pollo' },
  { id: '9', name: 'caldo de pollo' },
  { id: '10', name: 'limón' },
  { id: '11', name: 'nuez moscada' },
  { id: '12', name: 'aceite de oliva virgen extra' },
  { id: '13', name: 'aceite de sésamo' },
]

describe('matchIngredientName', () => {
  it('the same name, with other capitals, accents or plural, is «✓»', () => {
    expect(matchIngredientName('Lentejas', CATALOG)).toEqual({ status: 'match', ingredient: CATALOG[0] })
    expect(matchIngredientName('cebollas', CATALOG)).toEqual({ status: 'match', ingredient: CATALOG[1] })
    expect(matchIngredientName('limones', CATALOG)).toEqual({ status: 'match', ingredient: CATALOG[9] })
    expect(matchIngredientName('pimenton dulce', CATALOG)).toEqual({ status: 'match', ingredient: CATALOG[4] })
  })

  it('a cutting or cooking word does not change it', () => {
    expect(matchIngredientName('cebolla picada', CATALOG)).toEqual({ status: 'match', ingredient: CATALOG[1] })
  })

  it('more generic than several entries is «¿cuál?», up to 3, and takes the first if unanswered', () => {
    const r = matchIngredientName('pimentón', CATALOG)
    expect(r).toEqual({ status: 'doubt', candidates: [CATALOG[4], CATALOG[5]], fallback: 'first' })
    const aceite = matchIngredientName('aceite', CATALOG)
    expect(aceite.status).toBe('doubt')
    if (aceite.status === 'doubt') {
      expect(aceite.candidates).toHaveLength(3)
      expect(aceite.candidates[0]).toEqual(CATALOG[2])
    }
  })

  it('not there but with words in common asks, and is created new if unanswered', () => {
    const r = matchIngredientName('pechuga de pollo', CATALOG)
    expect(r).toEqual({ status: 'doubt', candidates: [CATALOG[7], CATALOG[8]], fallback: 'new' })
  })

  it('nothing alike is «nuevo»', () => {
    expect(matchIngredientName('kombu', CATALOG)).toEqual({ status: 'new' })
    expect(matchIngredientName('  ', CATALOG)).toEqual({ status: 'new' })
  })
})

describe('singularName', () => {
  it('drops the Spanish plural of each word', () => {
    expect(singularName('pimientos rojos')).toBe('pimiento rojo')
    expect(singularName('nueces')).toBe('nuez')
    expect(singularName('limones')).toBe('limon')
    expect(singularName('sal')).toBe('sal')
  })
})

// 24-nov: a handwritten «pimienta», read from a photo, came in as «pimienta
// rosa» because the shortest name won (13 letters against 14).
describe('the usual variant of a generic name goes first', () => {
  const PEPPERS = [
    { id: 'p1', name: 'pimienta rosa' },
    { id: 'p2', name: 'pimienta negra' },
    { id: 'p3', name: 'sal y pimienta' },
    { id: 'p4', name: 'pimentón dulce' },
  ]
  it('«pimienta» asks which, with the black one first: it is what goes in unanswered', () => {
    const r = matchIngredientName('pimienta', PEPPERS)
    expect(r.status).toBe('doubt')
    if (r.status !== 'doubt') return
    expect(r.fallback).toBe('first')
    expect(r.candidates[0]).toEqual(PEPPERS[1])
    expect(r.candidates.map((c) => c.name)).toContain('pimienta rosa')
  })
  it('a name without a usual variant keeps the shortest first', () => {
    const r = matchIngredientName('pimentón', [...PEPPERS, { id: 'p5', name: 'pimentón picante' }])
    expect(r.status === 'doubt' && r.candidates[0].name).toBe('pimentón dulce')
  })
})

