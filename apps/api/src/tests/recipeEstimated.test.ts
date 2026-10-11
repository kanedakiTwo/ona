/**
 * PRO-32 — the recipe detail says what is estimated. An ingredient imported
 * without an amount is stored with quantity 0; the detail must read
 * "cantidad sin indicar", never "0 g".
 *
 * Run: pnpm --filter @ona/api test src/tests/recipeEstimated.test.ts
 */

import { describe, expect, it } from 'vitest'
import { formatQuantity, QUANTITY_UNSTATED } from '../../../web/src/lib/recipeView'

describe('formatQuantity — quantity 0 (PRO-32)', () => {
  it('says "cantidad sin indicar" instead of "0 g" / "0 ml" / "0 uds"', () => {
    expect(QUANTITY_UNSTATED).toBe('cantidad sin indicar')
    for (const unit of ['g', 'ml', 'u', 'cda', 'cdita'] as const) {
      const out = formatQuantity(0, unit)
      expect(out).toBe('cantidad sin indicar')
      expect(out).not.toMatch(/^0/)
    }
  })

  it('keeps "una pizca" / "al gusto", which ignore the quantity', () => {
    expect(formatQuantity(0, 'pizca')).toBe('una pizca')
    expect(formatQuantity(0, 'al_gusto')).toBe('al gusto')
  })

  it('formats real amounts as before', () => {
    expect(formatQuantity(200, 'g')).toBe('200 g')
    expect(formatQuantity(1, 'u')).toBe('1 ud')
    expect(formatQuantity(2.5, 'cda')).toBe('2.5 cdas')
  })
})
