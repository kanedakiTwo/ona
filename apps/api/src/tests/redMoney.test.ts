/**
 * Red de tiendas: margin per line, products ceiling, «como mucho», what the
 * shop may reach and the split of a charge (design §2–§3).
 *
 * Run: pnpm --filter @ona/api test src/tests/redMoney.test.ts
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_RED_SETTINGS as S, type ShopOrderLine } from '@ona/shared'
import { householdAmount, householdMax, lineMarginPct, productsCeiling, productsEstimate, shopCeiling, splitCharge } from '../services/red/money.js'

const line = (over: Partial<ShopOrderLine>): ShopOrderLine => ({
  key: 'l1', sourceItemId: null, ingredientId: null, name: 'x', quantity: 1, unit: 'u', note: null,
  estimateEur: null, estimateSource: null, volatile: false, quote: null, verdict: null, reasons: [], decision: null, ...over,
})

describe('lineMarginPct', () => {
  it('15 % with the household’s or this shop’s price, 30 % with the national reference, +10 with wild fish', () => {
    expect(lineMarginPct(line({ estimateSource: 'manual' }), S)).toBe(15)
    expect(lineMarginPct(line({ estimateSource: 'historial' }), S)).toBe(15)
    expect(lineMarginPct(line({ estimateSource: 'referencia' }), S)).toBe(30)
    expect(lineMarginPct(line({ estimateSource: 'referencia', volatile: true }), S)).toBe(40)
  })
  it('an unknown price source gets the wider reference margin', () => {
    expect(lineMarginPct(line({ estimateSource: null }), S)).toBe(30)
    expect(lineMarginPct(line({ estimateSource: null, volatile: true }), S)).toBe(40)
  })
})

describe('productsEstimate / productsCeiling', () => {
  it('design example: 18 € with known prices → ceiling 20,70 €', () => {
    const lines = [line({ estimateEur: 10, estimateSource: 'historial' }), line({ key: 'l2', estimateEur: 8, estimateSource: 'manual' })]
    expect(productsEstimate(lines)).toBe(18)
    expect(productsCeiling(lines, S)).toBe(20.7)
  })
  it('line by line: each line takes its own margin', () => {
    const lines = [line({ estimateEur: 10, estimateSource: 'manual' }), line({ key: 'l2', estimateEur: 8, estimateSource: 'referencia' })]
    expect(productsCeiling(lines, S)).toBe(21.9) // 11,5 + 10,4
  })
  it('lines left out ("probablemente lo tienes" unticked) don’t count', () => {
    const lines = [line({ estimateEur: 10, estimateSource: 'manual' }), line({ key: 'l2', estimateEur: 8, estimateSource: 'manual', included: false })]
    expect(productsEstimate(lines)).toBe(10)
    expect(productsCeiling(lines, S)).toBe(11.5)
  })
  it('no ceiling when an included line has no estimate, or there are no lines', () => {
    expect(productsCeiling([line({ estimateEur: 10, estimateSource: 'manual' }), line({ key: 'l2' })], S)).toBeNull()
    expect(productsCeiling([], S)).toBeNull()
    expect(productsEstimate([line({})])).toBeNull()
  })
})

describe('householdMax / shopCeiling / householdAmount', () => {
  it('design example: ceiling 20,70 → 19,66 with the discount → max 20 €; the shop may reach 21,05 €', () => {
    // Design §2: the discount is rounded to the cent on its own (1,035 → 1,04), then subtracted: 20,70 − 1,04.
    expect(householdAmount(20.7, S)).toBe(19.66)
    expect(householdMax(20.7, null, S)).toBe(20)
    expect(shopCeiling(20, null, S)).toBe(21.05)
  })
  it('the delivery fee goes on top, outside the discount', () => {
    expect(householdMax(20.7, 3.5, S)).toBe(24) // 19,67 + 3,5 = 23,17 → 24
    expect(shopCeiling(24, 3.5, S)).toBe(21.57) // 20,5 / 0,95 = 21,578… down to the cent
  })
  it('no ceiling → no max', () => {
    expect(householdMax(null, 3, S)).toBeNull()
  })
  it('what the shop may reach never makes the household pay over the max', () => {
    for (const max of [7, 13, 20, 24, 57]) {
      const top = shopCeiling(max, 2, S)
      expect(householdAmount(top, S) + 2).toBeLessThanOrEqual(max)
    }
  })
  it('nor does the charge: max 3…200 € (to the cent), fee 0 / 2 / 3,50', () => {
    const over: string[] = []
    for (let maxCents = 300; maxCents <= 20_000; maxCents++) {
      const max = maxCents / 100
      for (const fee of [null, 2, 3.5]) {
        const paid = splitCharge(shopCeiling(max, fee, S), fee, S).householdPaysEur
        if (paid > max) over.push(`max ${max}, fee ${fee}: ${paid}`)
      }
    }
    expect(over).toEqual([])
  })
})

describe('splitCharge', () => {
  it('charges exactly what the household was shown, also on half cents', () => {
    expect(householdAmount(20.5, S)).toBe(19.47) // 1,025 → 1,03
    expect(splitCharge(20.5, null, S).householdPaysEur).toBe(19.47)
    expect(splitCharge(5.7, null, S).discountEur).toBe(0.29) // 0,285 rounds up
    for (let cents = 1; cents <= 10_000; cents++) {
      const shop = cents / 100
      if (splitCharge(shop, null, S).householdPaysEur !== householdAmount(shop, S)) throw new Error(`disagree at ${shop}`)
    }
  })
  it('design example: 18 € of products → the household pays 17,10; Mimoia 0,90; the shop 16,20 before the card fee', () => {
    expect(splitCharge(18, null, S)).toEqual({ discountEur: 0.9, commissionEur: 0.9, householdPaysEur: 17.1, shopGetsEur: 16.2 })
  })
  it('the fee is charged with the order, outside the 10 %', () => {
    expect(splitCharge(18, 3.5, S)).toEqual({ discountEur: 0.9, commissionEur: 0.9, householdPaysEur: 20.6, shopGetsEur: 19.7 })
  })
  it('follows the settings', () => {
    expect(splitCharge(20, null, { ...S, discountPct: 4, commissionPct: 6 })).toEqual({ discountEur: 0.8, commissionEur: 1.2, householdPaysEur: 19.2, shopGetsEur: 18 })
  })
})
