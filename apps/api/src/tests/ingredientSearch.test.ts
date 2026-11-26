/**
 * GET /ingredients?search= without case or accents (2026-11-10). Miguel typed "Tomate" in /recipes/new and the
 * picker offered only "Crear nuevo ingrediente": the route did a case-sensitive `LIKE '%Tomate%'` and the catalogue
 * says "tomate". These tests fail if the search goes back to comparing the raw text.
 */
import { describe, it, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { FOLD_FROM, foldIngredientName, hasSameIngredientName } from '@ona/shared'
import { FOLD_TO, escapeLike, ingredientSearch } from '../services/ingredientSearch.js'

const render = (s: Parameters<PgDialect['sqlToQuery']>[0]) => new PgDialect().sqlToQuery(s)

describe('foldIngredientName', () => {
  it('no case, no accents, single spaces', () => {
    expect(foldIngredientName('Tomate')).toBe('tomate')
    expect(foldIngredientName('  Brócoli   verde ')).toBe('brocoli verde')
    expect(foldIngredientName('Ñora')).toBe('nora')
    expect(foldIngredientName('Crème fraîche')).toBe('creme fraiche')
    expect(foldIngredientName('Romanescu')).toBe(foldIngredientName('romanescu'))
  })
})

describe('the SQL fold is the same rule as the term fold', () => {
  it('FOLD_TO has one plain letter per accented letter of FOLD_FROM', () => {
    expect([...FOLD_TO]).toHaveLength([...FOLD_FROM].length)
    ;[...FOLD_FROM].forEach((c, i) => {
      expect(FOLD_TO[i].toLowerCase()).toBe(foldIngredientName(c))
    })
  })
})

describe('escapeLike', () => {
  it('makes %, _ and \\ literal inside the LIKE pattern', () => {
    expect(escapeLike('50%_a\\b')).toBe('50\\%\\_a\\\\b')
  })
})

describe('ingredientSearch', () => {
  it('a blank term is no filter', () => {
    expect(ingredientSearch('   ')).toBeNull()
  })

  it('"Tomate" searches the folded column for "tomate", exact name first', () => {
    const s = ingredientSearch('Tomate')!
    expect(s.term).toBe('tomate')
    const where = render(s.where)
    expect(where.sql).toMatch(/lower\(translate\("ingredients"\."name"/)
    expect(where.sql).toMatch(/like \$\d+ escape/)
    expect(where.params).toContain('%tomate%')
    expect(where.params).not.toContain('%Tomate%')
    const rank = render(s.rank)
    expect(rank.params).toEqual(expect.arrayContaining(['tomate', 'tomate%', '% tomate%']))
  })

  it('"brocoli" (no accent) and "Brócoli" are the same search', () => {
    expect(render(ingredientSearch('brocoli')!.where).params).toContain('%brocoli%')
    expect(render(ingredientSearch('Brócoli')!.where).params).toContain('%brocoli%')
  })

  it('a % typed by the user is not a wildcard', () => {
    expect(render(ingredientSearch('100%')!.where).params).toContain('%100\\%%')
  })
})

describe('hasSameIngredientName (the form offers "Crear nuevo" only when it is new)', () => {
  it('the same name with other case or accents already exists', () => {
    expect(hasSameIngredientName([{ name: 'brócoli' }], 'Brocoli')).toBe(true)
    expect(hasSameIngredientName([{ name: 'tomate' }, { name: 'tomate cherry' }], 'Tomate ')).toBe(true)
  })

  it('a longer name that contains it is not the same', () => {
    expect(hasSameIngredientName([{ name: 'tomate cherry' }], 'tomate')).toBe(false)
    expect(hasSameIngredientName([], 'tomate')).toBe(false)
  })
})
