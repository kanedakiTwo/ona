/**
 * Recipe search (2026-11-25): in production «chuletón» found «Chuletón de
 * ternera a la plancha con patatas», but «chuleton» and «Chuletón con patatas»
 * found nothing (`GET /recipes?search=` was one substring with accents). These
 * fail if the search goes back to the raw text or to the words in order.
 */
import { describe, it, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { matchesRecipeSearch, recipeSearchRank, recipeSearchWords } from '@ona/shared'
import { recipeNameContains, recipeNameSearch } from '../services/recipeSearch.js'

const render = (s: Parameters<PgDialect['sqlToQuery']>[0]) => new PgDialect().sqlToQuery(s)
const CHULETON = 'Chuletón de ternera a la plancha con patatas'

describe('matchesRecipeSearch', () => {
  it('finds the chuletón without accent, with «con», and in another order', () => {
    expect(matchesRecipeSearch(CHULETON, 'chuletón')).toBe(true)
    expect(matchesRecipeSearch(CHULETON, 'chuleton')).toBe(true)
    expect(matchesRecipeSearch(CHULETON, 'Chuletón con patatas')).toBe(true)
    expect(matchesRecipeSearch(CHULETON, 'patatas chuleton')).toBe(true)
    expect(matchesRecipeSearch(CHULETON, 'CHULETON  PATAT')).toBe(true)
  })

  it('every word must be there', () => {
    expect(matchesRecipeSearch(CHULETON, 'chuleton merluza')).toBe(false)
    expect(matchesRecipeSearch(CHULETON, 'merluza')).toBe(false)
  })

  it('ñ = n, both ways', () => {
    expect(matchesRecipeSearch('Lasaña de verduras', 'lasana')).toBe(true)
    expect(matchesRecipeSearch('Lasana de verduras', 'lasaña')).toBe(true)
  })

  it('an empty search matches everything', () => {
    expect(matchesRecipeSearch(CHULETON, '  ')).toBe(true)
  })
})

describe('recipeSearchWords', () => {
  it('drops empty words, folds, dedupes; «sin» counts', () => {
    expect(recipeSearchWords('Chuletón con patatas')).toEqual(['chuleton', 'patatas'])
    expect(recipeSearchWords('pollo a la plancha, y al horno')).toEqual(['pollo', 'plancha', 'horno'])
    expect(recipeSearchWords('bizcocho sin huevo')).toEqual(['bizcocho', 'sin', 'huevo'])
    expect(recipeSearchWords('pollo pollo')).toEqual(['pollo'])
  })

  it('only empty words → those words, so the search still searches', () => {
    expect(recipeSearchWords('con')).toEqual(['con'])
    expect(recipeSearchWords('')).toEqual([])
  })
})

describe('recipeSearchRank', () => {
  it('names that start with a searched word go first', () => {
    expect(recipeSearchRank(CHULETON, 'patatas chuleton')).toBe(0)
    expect(recipeSearchRank('Patatas a la importancia', 'importancia')).toBe(1)
    const names = ['Ensalada de pollo', 'Pollo al curry', 'Sopa de pollo']
    const sorted = [...names].sort((a, b) => recipeSearchRank(a, 'pollo') - recipeSearchRank(b, 'pollo'))
    expect(sorted).toEqual(['Pollo al curry', 'Ensalada de pollo', 'Sopa de pollo'])
  })
})

describe('recipeNameSearch (SQL)', () => {
  it('a blank or empty search is no filter', () => {
    expect(recipeNameSearch('   ')).toBeNull()
  })

  it('one folded LIKE per word over the folded name, no stopwords', () => {
    const q = render(recipeNameSearch('Chuletón con patatas')!)
    expect(q.sql).toMatch(/lower\(translate\("recipes"\."name"/)
    expect(q.params).toContain('%chuleton%')
    expect(q.params).toContain('%patatas%')
    expect(q.params).not.toContain('%con%')
    expect(q.params).not.toContain('%Chuletón con patatas%')
    expect(q.sql.match(/ like /g)).toHaveLength(2)
    expect(q.sql).toMatch(/ and /)
  })

  it('punctuation is not part of a word (%, _ never reach the LIKE)', () => {
    expect(render(recipeNameSearch('50%_')!).params).toContain('%50%')
  })
})

describe('recipeNameContains (Mimo)', () => {
  it('folds the text', () => {
    expect(render(recipeNameContains('Chuletón')).params).toContain('%chuleton%')
  })
})
