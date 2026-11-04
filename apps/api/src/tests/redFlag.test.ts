/**
 * Red de tiendas v2 (specs/shop-orders.md → «Red de tiendas»): el código
 * postal, los esquemas de las rutas y el interruptor RED_TIENDAS_EMAILS.
 *
 * Run: pnpm --filter @ona/api test src/tests/redFlag.test.ts
 */
import { describe, it, expect } from 'vitest'
import { isPostalCode, patchShopOrderSchema, placeRedOrderSchema, postalCodeSchema, redChoiceSchema, redMaxBody, SHOP_ORDER_STATUSES, SHOP_ORDER_STATUS_LABELS } from '@ona/shared'
import { isEmailAllowed } from '../services/emailAllowList.js'
import { isRedAllowed } from '../services/red/flag.js'
import { isBasketExtensionAllowed } from '../services/basketExtension.js'

describe('isPostalCode', () => {
  it('takes 5 digits with a real province (01–52)', () => {
    expect(isPostalCode('28001')).toBe(true)
    expect(isPostalCode('01001')).toBe(true)
    expect(isPostalCode('52006')).toBe(true)
  })
  it('refuses everything else', () => {
    for (const v of ['2800', '280011', '00123', '53001', '28 001', 28001, null, undefined]) expect(isPostalCode(v)).toBe(false)
  })
})

describe('schemas', () => {
  it('postal code body trims and validates', () => {
    expect(postalCodeSchema.parse({ postalCode: ' 28001 ' })).toEqual({ postalCode: '28001' })
    expect(postalCodeSchema.safeParse({ postalCode: '99999' }).success).toBe(false)
  })
  it('choosing the Red needs the shop; choosing the súper does not', () => {
    expect(redChoiceSchema.safeParse({ kind: 'fruteria', choice: 'super' }).success).toBe(true)
    expect(redChoiceSchema.safeParse({ kind: 'fruteria', choice: 'red' }).success).toBe(false)
    expect(redChoiceSchema.safeParse({ kind: 'fruteria', choice: 'red', redShopId: '7d9f2c1e-0b4a-4c3e-9f1a-2b3c4d5e6f70' }).success).toBe(true)
    expect(redChoiceSchema.safeParse({ kind: 'supermercado', choice: 'super' }).success).toBe(false)
  })
  it('«Pedir» carries the max the household saw', () => {
    expect(placeRedOrderSchema.safeParse({ maxEur: 20 }).success).toBe(true)
    expect(placeRedOrderSchema.safeParse({ maxEur: 0 }).success).toBe(false)
  })
  it('contract: what the card sends for «Como mucho» is what PATCH /shop-orders/:id accepts', () => {
    for (const raw of ['20', '24,5 €', ' 30,25 ', '', 'abc', '0']) {
      const body = redMaxBody(raw)
      expect(patchShopOrderSchema.safeParse(body).success, raw).toBe(true)
    }
    expect(redMaxBody('24,5 €')).toEqual({ maxEur: 24.5 })
    expect(redMaxBody('')).toEqual({ maxEur: null })
    expect(redMaxBody('0')).toEqual({ maxEur: null })
  })
})

describe('order states', () => {
  it('the Red states exist and every state has a Spanish label', () => {
    for (const s of ['ordered', 'accepted', 'preparing', 'ready', 'payment_pending', 'charged', 'delivered', 'rejected', 'incident']) {
      expect(SHOP_ORDER_STATUSES).toContain(s)
    }
    for (const s of SHOP_ORDER_STATUSES) expect(SHOP_ORDER_STATUS_LABELS[s]).toBeTruthy()
  })
})

describe('RED_TIENDAS_EMAILS', () => {
  it('empty list = nobody; exact email or @domain, ignoring case', () => {
    expect(isRedAllowed('ana@test.local', [])).toBe(false)
    expect(isRedAllowed('Ana@Red.Test.Local', ['@red.test.local'])).toBe(true)
    expect(isRedAllowed('ana@test.local', ['@red.test.local'])).toBe(false)
    expect(isRedAllowed('miguel@x.es', ['miguel@x.es'])).toBe(true)
    expect(isRedAllowed(null, ['@red.test.local'])).toBe(false)
  })
  it('the extension’s switch keeps the same rule', () => {
    expect(isBasketExtensionAllowed('a@test.local', ['@test.local'])).toBe(true)
    expect(isEmailAllowed('a@test.local', [])).toBe(false)
  })
})
