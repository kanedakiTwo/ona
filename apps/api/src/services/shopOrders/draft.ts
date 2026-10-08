/**
 * Pure: shopping-list items → one draft line list per shop
 * (specs/shop-orders.md → Preparing the orders).
 *
 * 1. "Fruta (fresas, plátanos…)" splits into products.
 * 2. Each item gets its buy rule; pantry staples from recipes stay home.
 * 3. Duplicates merge by rule (recipe "jamón 50 g" + typed "Jamón serrano"
 *    → one line, serrano; "leche" + "leche entera" → one brik line).
 * 4. Lines are written in the shop's units (lines.ts).
 */

import {
  buyRuleByKey,
  resolveBuyRule,
  splitCompound,
  toOrderQty,
  normalizeBuyName,
  type BuyableUnit,
  type ShopKind,
  type ShopOrderLine,
  type ShoppingItem,
} from '@ona/shared'
import { classifyShopKind, kindForBuyShop, normalizeName, pickShopForKind, type RoutableShop } from './classify.js'
import { defaultCap, type PriceMemory } from './estimate.js'
import { buildLine, looksDefault, type LineInput } from './lines.js'

/** Pantry basics we assume are at home when no buy rule knows them (cda/cdita amounts, etc.). */
const PANTRY_BASICS = /^(sal|sal gorda|pimienta( negra| blanca)?|aceite( de oliva( virgen( extra)?)?| de girasol)?|vinagre.*|oregano|comino|canela|curcuma|pimenton.*|laurel|nuez moscada|tomillo seco|romero seco|azafran|levadura.*|bicarbonato|agua)$/

export interface DraftShop extends RoutableShop {
  priceMemory: PriceMemory
}

export interface DraftResult<S extends DraftShop> {
  byShop: Array<{ shop: S; kind: ShopKind; lines: ShopOrderLine[] }>
  /** Lines with no shop to send them to (the household has no shop of that kind and no súper). */
  unassigned: Array<{ name: string; quantity: number; unit: string; kind: ShopKind }>
  /** Left out on purpose, with the reason the user sees. */
  skipped: Array<{ name: string; reason: string }>
  /** Pantry staples the recipes use, left out ("¿Te falta algo de esto?"). */
  pantry: string[]
}

export function isPantryBasic(item: Pick<ShoppingItem, 'name' | 'unit' | 'quantity' | 'kind'>): boolean {
  if (item.kind === 'manual' || item.kind === 'staple') return false
  if (item.unit === 'cda' || item.unit === 'cdita') return true
  return PANTRY_BASICS.test(normalizeName(item.name))
}

interface Entry {
  id: string
  ingredientId: string | null
  name: string
  quantity: number
  unit: BuyableUnit
  source: 'recipe' | 'user' | 'default'
  notes: string[]
  aisle: string | null
  pricePerUnit: number | null
  kind: ShoppingItem['kind']
}

function sourceOf(item: ShoppingItem): Entry['source'] {
  if (item.kind === 'manual') return item.quantitySource ?? (looksDefault(item.quantity, item.unit) ? 'default' : 'user')
  if (item.kind === 'staple') return 'user'
  return 'recipe'
}

function expand(item: ShoppingItem): Entry[] {
  const base: Entry = {
    id: item.id,
    ingredientId: item.ingredientId,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    source: sourceOf(item),
    notes: item.notes ?? [],
    aisle: item.aisle,
    pricePerUnit: item.pricePerUnit ?? null,
    kind: item.kind,
  }
  const parts = splitCompound(item.name)
  if (!parts) return [base]
  return parts.map((name) => ({ ...base, ingredientId: null, name, quantity: 1, unit: 'u', source: 'default', notes: [], pricePerUnit: null }))
}

function gramsOf(e: Entry, ruleKey: string | null): number | null {
  switch (e.unit) {
    case 'g':
    case 'ml':
      return e.quantity
    case 'cda':
      return e.quantity * 15
    case 'cdita':
      return e.quantity * 5
    case 'u': {
      const rule = ruleKey ? buyRuleByKey(ruleKey) : null
      const per = rule?.ug ?? rule?.g
      return per ? e.quantity * per : null
    }
  }
}

/** Duplicates of the same product → one line input. */
function merge(members: Entry[], ruleKey: string | null, key: string): LineInput {
  const quantified = members.filter((m) => m.source !== 'default')
  const presets = members.map((m) => resolveBuyRule(m.name)?.preset).filter((p): p is string => !!p)
  const ids = [...new Set(members.map((m) => m.id))]
  const notes = [...new Set(members.flatMap((m) => m.notes))]
  const lead = quantified.find((m) => m.source === 'recipe') ?? quantified[0] ?? members[0]
  let quantity = lead.quantity
  let unit = lead.unit
  if (quantified.length > 1) {
    const units = new Set(quantified.map((m) => m.unit))
    if (units.size === 1) {
      quantity = quantified.reduce((acc, m) => acc + m.quantity, 0)
    } else {
      const grams = quantified.map((m) => gramsOf(m, ruleKey))
      if (grams.every((g) => g != null)) {
        quantity = (grams as number[]).reduce((a, b) => a + b, 0)
        unit = 'g'
      }
    }
  }
  return {
    key,
    sourceItemIds: ids,
    ingredientId: members.find((m) => m.ingredientId)?.ingredientId ?? null,
    name: lead.name,
    quantity,
    unit,
    quantitySource: quantified.length ? (quantified.some((m) => m.source === 'recipe') ? 'recipe' : 'user') : 'default',
    notes,
    note: null,
    choice: presets[0] ?? null,
    pricePerUnit: members.length === 1 ? members[0].pricePerUnit : null,
    // Typed by the user → they want it, even if the recipe amount alone would be "probablemente lo tienes".
    included: members.some((m) => m.source !== 'recipe') ? true : undefined,
  }
}

export function draftOrdersFromItems<S extends DraftShop>(
  items: ShoppingItem[],
  shops: S[],
  opts: { alreadyOrdered?: Set<string>; prefs?: Record<string, string> } = {},
): DraftResult<S> {
  const prefs = opts.prefs ?? {}
  const result: DraftResult<S> = { byShop: [], unassigned: [], skipped: [], pantry: [] }
  const groups = new Map<string, { shop: S; kind: ShopKind; members: Entry[]; ruleKey: string | null; order: number }>()
  let order = 0

  for (const item of items) {
    if (item.checked || item.inStock || !(item.quantity > 0)) continue
    if (opts.alreadyOrdered?.has(item.id)) {
      result.skipped.push({ name: item.name, reason: 'ya está en un pedido abierto' })
      continue
    }
    for (const e of expand(item)) {
      const conv = toOrderQty({ name: e.name, quantity: e.quantity, unit: e.unit, notes: e.notes, quantitySource: e.source }, prefs)
      if (e.source === 'recipe' && (conv.shop === 'despensa' || (!conv.ruleKey && isPantryBasic(item)))) {
        result.skipped.push({ name: e.name, reason: 'básico de despensa (se da por hecho que lo tienes)' })
        result.pantry.push(e.name.split(' · ')[0])
        continue
      }
      const kind = conv.shop ? kindForBuyShop(conv.shop) : classifyShopKind(e.name, e.aisle)
      const shop = pickShopForKind(kind, shops)
      if (!shop) {
        result.unassigned.push({ name: e.name, quantity: e.quantity, unit: e.unit, kind })
        continue
      }
      const gk = `${shop.id}|${conv.ruleKey ?? `name:${normalizeBuyName(e.name)}`}`
      let g = groups.get(gk)
      if (!g) {
        g = { shop, kind: shop.kind, members: [], ruleKey: conv.ruleKey, order: order++ }
        groups.set(gk, g)
      }
      g.members.push(e)
    }
  }

  const byShop = new Map<string, { shop: S; kind: ShopKind; lines: ShopOrderLine[] }>()
  for (const g of [...groups.values()].sort((a, b) => a.order - b.order)) {
    let entry = byShop.get(g.shop.id)
    if (!entry) {
      entry = { shop: g.shop, kind: g.shop.kind, lines: [] }
      byShop.set(g.shop.id, entry)
    }
    const input = merge(g.members, g.ruleKey, `l${entry.lines.length + 1}`)
    entry.lines.push(buildLine(input, g.shop.kind, prefs, g.shop.priceMemory))
  }
  result.byShop = [...byShop.values()].sort((a, b) => a.shop.position - b.shop.position)
  result.pantry = [...new Set(result.pantry)]
  return result
}

export function sumEstimate(lines: ShopOrderLine[]): number | null {
  const known = lines.filter((l) => l.included !== false && l.estimateEur != null)
  if (!known.length) return null
  return Math.round(known.reduce((acc, l) => acc + (l.estimateEur as number), 0) * 100) / 100
}

/**
 * Default "hasta X €" for a draft. National averages are far too rough for
 * small baskets (shops sell whole pieces), so a cap is only proposed when
 * at least half of the estimate comes from the user's own prices or this
 * shop's last quote. Otherwise the user sets it — ONA never invents a margin.
 */
export function capForLines(lines: ShopOrderLine[]): number | null {
  const total = sumEstimate(lines)
  if (!total) return null
  const precise = lines
    .filter((l) => l.included !== false && l.estimateEur != null && (l.estimateSource === 'manual' || l.estimateSource === 'historial'))
    .reduce((acc, l) => acc + (l.estimateEur as number), 0)
  if (precise / total < 0.5) return null
  return defaultCap(total, lines.some((l) => l.volatile))
}
