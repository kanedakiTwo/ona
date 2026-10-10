/**
 * /shopping progress: a row bought and then marked "en casa" must count once.
 * Regression of 2026-10-10 ("72/56 completados · 129 % listo"): the page added
 * checked + inStock, so overlapping rows were counted twice.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { shoppingProgress } from '@ona/shared'
import { REPO } from './helpers/legacyPalette.js'

describe('shoppingProgress', () => {
  it('counts a row that is both bought and at home once, as at home', () => {
    const items = [
      { checked: true, inStock: true },
      { checked: true, inStock: false },
      { checked: false, inStock: true },
      { checked: false, inStock: false },
    ]
    expect(shoppingProgress(items)).toEqual({ total: 4, bought: 1, atHome: 2, done: 3, ratio: 0.75 })
  })

  it('never passes 100 % (the 72/56 case)', () => {
    // 56 rows: 16 bought then marked at home, 8 only bought, 32 only at home.
    const items = [
      ...Array.from({ length: 16 }, () => ({ checked: true, inStock: true })),
      ...Array.from({ length: 8 }, () => ({ checked: true, inStock: false })),
      ...Array.from({ length: 32 }, () => ({ checked: false, inStock: true })),
    ]
    const p = shoppingProgress(items)
    expect(p.done).toBe(56)
    expect(p.done).toBeLessThanOrEqual(p.total)
    expect(p.ratio).toBe(1)
  })

  it('is 0 for an empty list', () => {
    expect(shoppingProgress([])).toEqual({ total: 0, bought: 0, atHome: 0, done: 0, ratio: 0 })
  })

  it('/shopping uses it instead of adding checked + inStock', () => {
    const page = readFileSync(resolve(REPO, 'apps/web/src/app/shopping/page.tsx'), 'utf8')
    expect(page).toContain('shoppingProgress(')
    expect(page).not.toMatch(/checkedCount\s*\+\s*inStockCount/)
  })
})
