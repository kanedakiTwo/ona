/**
 * Calendario de producto + «Este mes» (PRO-375, specs/recipes.md): which
 * products are in season each month, which ingredient names count as each
 * one, and the row's rule (≥3 recipes, most used first).
 */
import { describe, expect, it } from 'vitest'
import {
  SEASONAL_PRODUCE,
  findProduce,
  ingredientMatchesProduce,
  produceInSeason,
} from '@ona/shared'
import { countSeasonalProduce, madridMonth } from '../services/seasonalProduce.js'

const names = (month: number) => produceInSeason(month).map((p) => p.name)

describe('calendario de producto', () => {
  it('has calabaza and setas in October, not in July', () => {
    expect(names(10)).toEqual(expect.arrayContaining(['Calabaza', 'Setas', 'Castañas', 'Granada']))
    expect(names(7)).not.toContain('Calabaza')
    expect(names(7)).not.toContain('Setas')
  })

  it('has about sixty products, each with an emoji, a term and valid months', () => {
    expect(SEASONAL_PRODUCE.length).toBeGreaterThanOrEqual(55)
    expect(new Set(SEASONAL_PRODUCE.map((p) => p.name)).size).toBe(SEASONAL_PRODUCE.length)
    for (const p of SEASONAL_PRODUCE) {
      expect(p.emoji.length).toBeGreaterThan(0)
      expect(p.terms.length).toBeGreaterThan(0)
      expect(p.months.length).toBeGreaterThan(0)
      for (const m of p.months) expect(m >= 1 && m <= 12).toBe(true)
    }
    for (let m = 1; m <= 12; m++) expect(produceInSeason(m).length).toBeGreaterThan(5)
  })

  it('finds a product by name, plural or without accents', () => {
    expect(findProduce('calabaza')?.name).toBe('Calabaza')
    expect(findProduce('Setas')?.name).toBe('Setas')
    expect(findProduce('seta')?.name).toBe('Setas')
    expect(findProduce('castañas')?.name).toBe('Castañas')
    expect(findProduce('judías verdes')?.name).toBe('Judías verdes')
    expect(findProduce('garbanzos')).toBeUndefined()
  })

  it('matches ingredient names by whole word: calabaza is not calabacín', () => {
    const calabaza = findProduce('calabaza')!
    expect(ingredientMatchesProduce('Calabaza', calabaza)).toBe(true)
    expect(ingredientMatchesProduce('calabaza asada', calabaza)).toBe(true)
    expect(ingredientMatchesProduce('Calabacín', calabaza)).toBe(false)
    const setas = findProduce('setas')!
    expect(ingredientMatchesProduce('Champiñones', setas)).toBe(true)
    expect(ingredientMatchesProduce('setas variadas', setas)).toBe(true)
    const manzana = findProduce('manzana')!
    expect(ingredientMatchesProduce('Manzana golden', manzana)).toBe(true)
    expect(ingredientMatchesProduce('vinagre de manzana', manzana)).toBe(false)
    const col = findProduce('col')!
    expect(ingredientMatchesProduce('coles de Bruselas', col)).toBe(false)
    expect(ingredientMatchesProduce('coles de Bruselas', findProduce('coles de bruselas')!)).toBe(true)
    // A free name not in the calendar is its own term.
    expect(ingredientMatchesProduce('garbanzos cocidos', 'garbanzos')).toBe(true)
    expect(ingredientMatchesProduce('lentejas', 'garbanzos')).toBe(false)
  })
})

describe('«Este mes» row', () => {
  const rows = [
    ...['r1', 'r2', 'r3'].map((recipeId) => ({ recipeId, ingredientName: 'calabaza' })),
    { recipeId: 'r4', ingredientName: 'calabaza asada' },
    ...['r1', 'r2', 'r5'].map((recipeId) => ({ recipeId, ingredientName: 'champiñones' })),
    // Two in one recipe count once.
    { recipeId: 'r1', ingredientName: 'boletus' },
    // Only two recipes: out.
    ...['r6', 'r7'].map((recipeId) => ({ recipeId, ingredientName: 'granada' })),
    // Calabacín is not calabaza; and it's out of season in October.
    ...['r8', 'r9', 'r10'].map((recipeId) => ({ recipeId, ingredientName: 'calabacín' })),
  ]

  it('keeps the month products with at least 3 recipes, most used first', () => {
    expect(countSeasonalProduce(rows, 10)).toEqual([
      { name: 'Calabaza', emoji: '🎃', recipeCount: 4 },
      { name: 'Setas', emoji: '🍄', recipeCount: 3 },
    ])
  })

  it('in July shows neither calabaza nor setas', () => {
    expect(countSeasonalProduce(rows, 7).map((p) => p.name)).toEqual(['Calabacín'])
  })

  it('takes the month in Madrid, not in UTC', () => {
    // 31 Oct 23:30 UTC is already 1 Nov in Madrid (UTC+1).
    expect(madridMonth(new Date('2026-10-31T23:30:00Z'))).toBe(11)
    expect(madridMonth(new Date('2026-10-15T12:00:00Z'))).toBe(10)
  })
})
