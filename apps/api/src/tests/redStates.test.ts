/**
 * Red de tiendas: order states and transitions (design §4).
 *
 * Run: pnpm --filter @ona/api test src/tests/redStates.test.ts
 */
import { describe, it, expect } from 'vitest'
import { canRedTransition, householdCanCancelRed, RED_IN_FLIGHT, RED_LISTED_OPEN } from '../services/red/states.js'
import { refuseRedInOldFlow, ShopOrderError } from '../services/shopOrders/store.js'
import { DEFAULT_RED_SETTINGS } from '@ona/shared'

describe('canRedTransition', () => {
  it('follows the design table', () => {
    const ok: Array<[string, string]> = [
      ['draft', 'ordered'], ['draft', 'cancelled'],
      ['ordered', 'accepted'], ['ordered', 'rejected'], ['ordered', 'cancelled'],
      ['accepted', 'preparing'], ['accepted', 'cancelled'],
      ['preparing', 'ready'], ['preparing', 'cancelled'],
      ['ready', 'charged'], ['ready', 'payment_pending'],
      ['payment_pending', 'charged'], ['payment_pending', 'cancelled'],
      ['charged', 'delivered'],
      ['delivered', 'closed'], ['delivered', 'incident'],
      ['incident', 'closed'],
    ]
    for (const [from, to] of ok) expect(canRedTransition(from, to), `${from} → ${to}`).toBe(true)
    const no: Array<[string, string]> = [['draft', 'charged'], ['rejected', 'ordered'], ['cancelled', 'ordered'], ['closed', 'incident'], ['charged', 'cancelled'], ['ready', 'cancelled']]
    for (const [from, to] of no) expect(canRedTransition(from, to), `${from} → ${to}`).toBe(false)
  })
})

describe('what the household can do and what counts as ordered', () => {
  it('cancels in draft, ordered and accepted (once preparing, only if the shop agrees: tramo 1b)', () => {
    expect(['draft', 'ordered', 'accepted'].every(householdCanCancelRed)).toBe(true)
    expect(['preparing', 'ready', 'charged'].some(householdCanCancelRed)).toBe(false)
  })
  it('lines in ordered…payment_pending are «ya está en un pedido abierto»; charged, delivered and incident are still listed', () => {
    expect(RED_IN_FLIGHT).toEqual(['ordered', 'accepted', 'preparing', 'ready', 'payment_pending'])
    expect(RED_LISTED_OPEN).toEqual([...RED_IN_FLIGHT, 'charged', 'delivered', 'incident'])
  })
})

describe('refuseRedInOldFlow', () => {
  it('a Red order can’t be marked sent, quoted or approved; the household’s own shops can', () => {
    expect(() => refuseRedInOldFlow({ redShopId: 'r1', redTerms: DEFAULT_RED_SETTINGS }, 'envían por WhatsApp')).toThrow(ShopOrderError)
    expect(() => refuseRedInOldFlow({ redShopId: null, redTerms: null }, 'envían por WhatsApp')).not.toThrow()
  })
  it('uses the one Red-order rule (isRedOrderRow): a Red shop without frozen terms is not a Red order', () => {
    expect(() => refuseRedInOldFlow({ redShopId: 'r1', redTerms: null }, 'envían por WhatsApp')).not.toThrow()
  })
})
