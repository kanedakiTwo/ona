import { describe, expect, it } from 'vitest'
import { fitOf, rankCookNow, type CookNowCandidate, type CookNowContext } from '../services/cookNow/search.js'

const ing = (name: string, over: Record<string, unknown> = {}) => ({ ingredientId: name, ingredientName: name, quantity: 200, unit: 'g', ...over })
const recipe = (name: string, totalTime: number | null, ingredients: ReturnType<typeof ing>[], over: Partial<CookNowCandidate> = {}): CookNowCandidate => ({
  id: name, name, servings: 4, totalTime, ingredients, ...over,
})
const pantry = (name: string, quantity = 1000, over: Record<string, unknown> = {}) => ({ ingredientId: name, name, quantity, unit: 'g', expiresAt: null, ...over })
const ctx = (over: Partial<CookNowContext> = {}): CookNowContext => ({
  pantry: [], staples: [], substituteNames: new Map(), boost: new Set(), cookedRecently: new Set(), today: '2026-11-03', ...over,
})
const answers = (over = {}) => ({ minutes: 30 as 15 | 30 | 45 | null, servings: 4, canBuy: false, ...over })

describe('fitOf', () => {
  it('fits, margin up to +20 %, out beyond; no time is out; no limit fits', () => {
    expect(fitOf({ totalTime: 30 }, 30)).toBe('fits')
    expect(fitOf({ totalTime: 36 }, 30)).toBe('margin')
    expect(fitOf({ totalTime: 37 }, 30)).toBeNull()
    expect(fitOf({ totalTime: null }, 30)).toBeNull()
    expect(fitOf({ totalTime: 240 }, null)).toBe('fits')
  })
})

describe('rankCookNow · «solo lo que hay»', () => {
  const tortilla = recipe('Tortilla', 25, [ing('huevo', { category: 'proteina' }), ing('patata', { quantity: 600 }), ing('perejil', { quantity: 5 })])
  it('a missing secondary does not take the recipe out', () => {
    const { hits } = rankCookNow([tortilla], answers(), ctx({ pantry: [pantry('huevo'), pantry('patata')] }))
    expect(hits).toHaveLength(1)
    expect(hits[0].missingSecondary).toEqual(['perejil'])
    expect(hits[0].missingEssential).toEqual([])
  })
  it('a missing essential takes it out, unless nothing fits: then one missing thing is shown', () => {
    const { hits, fallback } = rankCookNow([tortilla], answers(), ctx({ pantry: [pantry('patata')] }))
    expect(fallback).toBe(true)
    expect(hits[0].missingEssential).toEqual(['huevo'])
  })
  it('basics never count, staples count as at home, substitutes in the pantry count', () => {
    const crema = recipe('Crema', 30, [ing('calabacín', { quantity: 800 }), ing('nata', { quantity: 300, unit: 'ml', role: 'essential', substituteIngredientIds: ['leche'] }), ing('Sal', { quantity: 5 }), ing('cebolla', { quantity: 300 })])
    const { hits } = rankCookNow([crema], answers(), ctx({ pantry: [pantry('calabacín'), pantry('leche')], staples: ['Cebollas'], substituteNames: new Map([['leche', 'leche']]) }))
    expect(hits).toHaveLength(1)
    expect(hits[0].substitutions).toEqual([{ missing: 'nata', use: 'leche' }])
  })
  it('not enough of an essential (same unit) counts as missing and short', () => {
    const arroz = recipe('Arroz', 30, [ing('arroz', { category: 'cereal', quantity: 300 })])
    const { hits, fallback } = rankCookNow([arroz], answers({ servings: 4 }), ctx({ pantry: [pantry('arroz', 100)] }))
    expect(fallback).toBe(true)
    expect(hits[0].short).toEqual(['arroz'])
  })
  it('different units are taken as enough', () => {
    const arroz = recipe('Arroz', 30, [ing('arroz', { category: 'cereal', quantity: 300 })])
    const { hits, fallback } = rankCookNow([arroz], answers(), ctx({ pantry: [pantry('arroz', 1, { unit: 'u' })] }))
    expect(fallback).toBe(false)
    expect(hits).toHaveLength(1)
  })
  it('servings scale what is needed', () => {
    const arroz = recipe('Arroz', 30, [ing('arroz', { category: 'cereal', quantity: 400 })])
    expect(rankCookNow([arroz], answers({ servings: 1 }), ctx({ pantry: [pantry('arroz', 100)] })).fallback).toBe(false)
  })
})

describe('rankCookNow · «sí, algo»', () => {
  it('allows up to two missing essentials', () => {
    const r = recipe('Guiso', 40, [ing('ternera', { category: 'proteina' }), ing('patata', { quantity: 800 }), ing('zanahoria', { quantity: 400 })])
    expect(rankCookNow([r], answers({ minutes: 45, canBuy: true }), ctx({ pantry: [pantry('patata')] })).hits).toHaveLength(1)
    expect(rankCookNow([r], answers({ minutes: 45, canBuy: true }), ctx()).hits).toHaveLength(0)
  })
})

describe('rankCookNow · order', () => {
  it('fits before margin, then fewer missing essentials, then more pantry (expiring counts double), then fewer missing secondaries', () => {
    const a = recipe('A margen', 35, [ing('huevo', { category: 'proteina' })])
    const b = recipe('B cabe', 25, [ing('huevo', { category: 'proteina' })])
    expect(rankCookNow([a, b], answers(), ctx({ pantry: [pantry('huevo')] })).hits.map((h) => h.recipe.name)).toEqual(['B cabe', 'A margen'])

    const c = recipe('C usa uno', 20, [ing('huevo', { category: 'proteina' })])
    const d = recipe('D usa caducado', 20, [ing('pollo', { category: 'proteina' })])
    const order = rankCookNow([c, d], answers(), ctx({ pantry: [pantry('huevo'), pantry('pollo', 1000, { expiresAt: '2026-11-05' })] })).hits.map((h) => h.recipe.name)
    expect(order).toEqual(['D usa caducado', 'C usa uno'])
  })
  it('«Repetir a menudo» before, cooked in the last 7 days after, as tie-breaks', () => {
    const e = recipe('E', 20, [ing('huevo', { category: 'proteina' })])
    const f = recipe('F', 20, [ing('huevo', { category: 'proteina' })])
    const g = recipe('G', 20, [ing('huevo', { category: 'proteina' })])
    const hits = rankCookNow([e, f, g], answers(), ctx({ pantry: [pantry('huevo')], boost: new Set(['G']), cookedRecently: new Set(['E']) })).hits
    expect(hits.map((h) => h.recipe.name)).toEqual(['G', 'F', 'E'])
  })
})
