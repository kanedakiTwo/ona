/**
 * PRO-241 (Laura, 2026-10-18): the list rounded to the nearest step, so a
 * person cooking alone came up short — 60 g of basmati → 50 g, 32 g of
 * butter → 25 g, 8 g → nothing. Now it always rounds up.
 */
import { describe, expect, it } from 'vitest'
import { roundForUnit, roundMassVolume, roundUnitWhole } from '../services/shoppingList.js'

describe('the shopping list rounds up (PRO-241)', () => {
  it('g and ml go up to their step', () => {
    expect(roundMassVolume(60)).toBe(75)
    expect(roundMassVolume(80)).toBe(100)
    expect(roundMassVolume(30)).toBe(50)
    expect(roundMassVolume(32)).toBe(50)
    expect(roundMassVolume(8)).toBe(25)
    expect(roundMassVolume(25)).toBe(25)
    expect(roundMassVolume(260)).toBe(300)
    expect(roundMassVolume(1020)).toBe(1100)
    expect(roundMassVolume(0)).toBe(0)
  })

  it('units go up to the next whole one', () => {
    expect(roundUnitWhole(1.2)).toBe(2)
    expect(roundUnitWhole(0.3)).toBe(1)
    expect(roundUnitWhole(3)).toBe(3)
    // Float noise from scaling is not another egg.
    expect(roundUnitWhole(6.0000000001)).toBe(6)
  })

  it('never less than the recipes add up to', () => {
    for (const unit of ['g', 'ml', 'u', 'cda', 'cdita'] as const) {
      for (const q of [0.4, 1.1, 7.5, 13, 26, 60, 249, 251, 999, 1001, 2345]) {
        expect(roundForUnit(q, unit)).toBeGreaterThanOrEqual(q)
      }
    }
  })
})
