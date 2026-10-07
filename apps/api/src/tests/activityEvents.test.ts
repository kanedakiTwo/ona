/**
 * Which requests / assistant skills count as "used the shopping list" for the
 * resolved-week metric (specs/metrics.md). The classifier is pure; the insert
 * is fire-and-forget and skipped under vitest.
 */
import { describe, expect, it } from 'vitest'
import { shoppingActivityKind, skillActivityKind } from '../services/activityEvents.js'

describe('shoppingActivityKind (HTTP routes)', () => {
  it('maps the shopping-list item mutations', () => {
    expect(shoppingActivityKind('PUT', '/shopping-list/l1/item/i1/check')).toBe('shopping_check')
    expect(shoppingActivityKind('PUT', '/shopping-list/l1/item/i1/stock')).toBe('shopping_stock')
    expect(shoppingActivityKind('POST', '/shopping-list/l1/items')).toBe('shopping_add')
  })

  it('ignores reads (the list row is rewritten on every GET, also by the WhatsApp reminder) and other routes', () => {
    expect(shoppingActivityKind('GET', '/shopping-list')).toBeNull()
    expect(shoppingActivityKind('GET', '/shopping-list/l1/totals')).toBeNull()
    expect(shoppingActivityKind('POST', '/shopping-list/l1/regenerate')).toBeNull()
    expect(shoppingActivityKind('PUT', '/menu/m1/item/i1/check')).toBeNull()
  })
})

describe('skillActivityKind (assistant / voice skills that write the list directly)', () => {
  it('maps check_shopping_item and mark_in_stock', () => {
    expect(skillActivityKind('check_shopping_item')).toBe('shopping_check')
    expect(skillActivityKind('mark_in_stock')).toBe('shopping_stock')
  })

  it('other skills are not shopping use (add/remove items go through the HTTP route and are caught there)', () => {
    expect(skillActivityKind('get_shopping_list')).toBeNull()
    expect(skillActivityKind('generate_weekly_menu')).toBeNull()
  })
})
