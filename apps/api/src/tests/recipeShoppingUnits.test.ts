/**
 * PRO-90: the "Para hacer la compra" notice didn't go away after fixing the
 * recipe. Typing an amount on a row "al gusto" kept the unit (saved as
 * "1 al gusto", still unbuyable), and the notice proposed "1 trozo" /
 * "1 manojo", units the form's selector doesn't have.
 */
import { describe, it, expect } from 'vitest'
import { buyableUnitFor, quantityHintFor, unitAfterQuantity } from '@ona/shared'
import { shoppabilityIssues, type ShoppableRow } from '../services/recipeShoppability.js'

const row = (name: string, quantity: number, unit: ShoppableRow['unit']): ShoppableRow => ({ name, quantity, unit })
const codes = (rows: ShoppableRow[]) => shoppabilityIssues(rows).map((i) => i.code)

describe('BUY_NO_QUANTITY with the units the form saves', () => {
  it('jengibre: "1 ud" and "20 g" are fine; "1 al gusto" is not', () => {
    expect(codes([row('jengibre fresco', 1, 'u')])).toEqual([])
    expect(codes([row('jengibre fresco', 20, 'g')])).toEqual([])
    expect(codes([row('jengibre fresco', 1, 'al_gusto')])).toEqual(['BUY_NO_QUANTITY'])
  })

  it('cilantro: "1 ud" is fine; "1 al gusto" is not', () => {
    expect(codes([row('cilantro', 1, 'u')])).toEqual([])
    expect(codes([row('cilantro', 1, 'al_gusto')])).toEqual(['BUY_NO_QUANTITY'])
  })

  it('the hint only proposes units the selector has', () => {
    const [jengibre, cilantro] = shoppabilityIssues([row('jengibre fresco', 0, 'al_gusto'), row('cilantro', 0, 'al_gusto')])
    expect(jengibre.message).toContain('(p. ej. 1 ud (trozo) de jengibre fresco)')
    expect(cilantro.message).toContain('(p. ej. 1 ud (manojo) de cilantro)')
    for (const m of [jengibre.message, cilantro.message]) expect(m).not.toMatch(/\b1 (trozo|manojo)\b/)
  })
})

describe('unit after typing an amount on the form', () => {
  it('al gusto / pizca + amount → "u" when sold by the piece, "g" otherwise', () => {
    expect(unitAfterQuantity('jengibre fresco', 'al_gusto', 1)).toBe('u')
    expect(unitAfterQuantity('cilantro', 'pizca', 1)).toBe('u')
    expect(unitAfterQuantity('espinacas', 'al_gusto', 200)).toBe('g')
    expect(unitAfterQuantity('alga kombu', 'al_gusto', 5)).toBe('g')
  })

  it('leaves the unit alone when it is already measurable or no amount was typed', () => {
    expect(unitAfterQuantity('jengibre fresco', 'g', 20)).toBe('g')
    expect(unitAfterQuantity('cilantro', 'al_gusto', '')).toBe('al_gusto')
    expect(unitAfterQuantity('cilantro', 'al_gusto', 0)).toBe('al_gusto')
  })

  it('the unit it picks clears the notice', () => {
    for (const name of ['jengibre fresco', 'cilantro', 'aguacate']) {
      expect(codes([row(name, 1, buyableUnitFor(name))])).toEqual([])
    }
  })

  it('hint for a pantry-less, rule-less product is null', () => {
    expect(quantityHintFor('alga kombu')).toBeNull()
  })
})
