/**
 * One order line from what the list needs — the same function on draft and
 * on every edit, so the text the shop reads always follows the buy rules
 * (specs/shop-orders.md → Buy rules).
 */

import { capitalize, formatQty, prettyName, toOrderQty, type BuyableUnit, type ShopKind, type ShopOrderLine } from '@ona/shared'
import { estimateLine, type PriceMemory } from './estimate.js'
import { isVolatileFish } from './fish.js'
import { lineRequestText } from './format.js'

export interface LineInput {
  key: string
  sourceItemIds: string[]
  ingredientId: string | null
  name: string
  quantity: number
  unit: BuyableUnit
  quantitySource: 'recipe' | 'user' | 'default'
  notes: string[]
  note: string | null
  choice: string | null
  included?: boolean
  pricePerUnit?: number | null
}

export function buildLine(input: LineInput, kind: ShopKind, prefs: Record<string, string>, memory: PriceMemory): ShopOrderLine {
  const conv = toOrderQty(
    { name: input.name, quantity: input.quantity, unit: input.unit, notes: input.notes, quantitySource: input.quantitySource, choice: input.choice, note: input.note },
    prefs,
  )
  let text: string
  if (conv.ruleKey) text = conv.text
  else if (input.quantitySource === 'default') text = capitalize(prettyName(input.name.trim()))
  else text = lineRequestText({ name: input.name, quantity: input.quantity, unit: input.unit, note: input.note }, kind).replace(/^- /, '')

  const grams = conv.ruleKey ? conv.grams : null
  const est = estimateLine(
    { ingredientId: input.ingredientId, name: input.name, quantity: input.quantity, unit: input.unit, pricePerUnit: input.pricePerUnit, grams, ruleKey: conv.ruleKey },
    kind,
    memory,
  )
  return {
    key: input.key,
    sourceItemId: input.sourceItemIds[0] ?? null,
    sourceItemIds: input.sourceItemIds,
    ingredientId: input.ingredientId,
    name: input.name,
    quantity: input.quantity,
    unit: input.unit,
    quantitySource: input.quantitySource,
    notes: input.notes,
    note: input.note,
    ruleKey: conv.ruleKey,
    text,
    grams,
    choice: conv.choice,
    options: conv.options,
    needsChoice: conv.needsChoice,
    needsQuantity: conv.needsQuantity,
    maybeHave: conv.maybeHave,
    included: input.included ?? !conv.maybeHave,
    eci: conv.eci,
    estimateEur: conv.needsQuantity ? null : est.eur,
    estimateSource: conv.needsQuantity ? null : est.source,
    volatile: kind === 'pescaderia' && (conv.ruleKey ? conv.volatile : isVolatileFish(input.name)),
    quote: null,
    verdict: null,
    reasons: [],
    decision: null,
  }
}

/** The inputs a stored line was built from (v1 lines lack some fields). */
export function inputOf(line: ShopOrderLine): LineInput {
  return {
    key: line.key,
    sourceItemIds: line.sourceItemIds ?? (line.sourceItemId ? [line.sourceItemId] : []),
    ingredientId: line.ingredientId,
    name: line.name,
    quantity: line.quantity,
    unit: line.unit,
    quantitySource: line.quantitySource ?? 'recipe',
    notes: line.notes ?? [],
    note: line.note,
    choice: line.choice ?? null,
    included: line.included,
  }
}

/** What the shop reads for a line (v1 lines have no `text`). */
export function lineText(line: ShopOrderLine, kind: ShopKind): string {
  if (line.text) return line.text
  return lineRequestText(line, kind).replace(/^- /, '')
}

/** Recipe "u" with no quantity typed — v1 manual items were stored as 1 u. */
export function looksDefault(q: number, unit: BuyableUnit): boolean {
  return q === 1 && unit === 'u'
}

export { formatQty }
