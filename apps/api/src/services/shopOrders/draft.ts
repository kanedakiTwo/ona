/**
 * Pure: shopping-list items → one draft line list per shop
 * (specs/shop-orders.md → Preparing the orders).
 */

import type { ShopKind, ShopOrderLine, ShoppingItem } from '@ona/shared'
import { classifyShopKind, normalizeName, pickShopForKind, type RoutableShop } from './classify.js'
import { defaultCap, estimateLine, type PriceMemory } from './estimate.js'
import { isVolatileFish } from './fish.js'

/** Pantry basics we assume are at home — a recipe's 2 cucharadas de aceite is not an order line. */
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
}

export function isPantryBasic(item: Pick<ShoppingItem, 'name' | 'unit' | 'quantity' | 'kind'>): boolean {
  if (item.kind === 'manual' || item.kind === 'staple') return false
  if (item.unit === 'cda' || item.unit === 'cdita') return true
  return PANTRY_BASICS.test(normalizeName(item.name))
}

export function draftOrdersFromItems<S extends DraftShop>(
  items: ShoppingItem[],
  shops: S[],
  opts: { alreadyOrdered?: Set<string> } = {},
): DraftResult<S> {
  const result: DraftResult<S> = { byShop: [], unassigned: [], skipped: [] }
  const groups = new Map<string, { shop: S; kind: ShopKind; lines: ShopOrderLine[] }>()

  for (const item of items) {
    if (item.checked || item.inStock || !(item.quantity > 0)) continue
    if (opts.alreadyOrdered?.has(item.id)) {
      result.skipped.push({ name: item.name, reason: 'ya está en un pedido abierto' })
      continue
    }
    if (isPantryBasic(item)) {
      result.skipped.push({ name: item.name, reason: 'básico de despensa (se da por hecho que lo tienes)' })
      continue
    }
    const kind = classifyShopKind(item.name, item.aisle)
    const shop = pickShopForKind(kind, shops)
    if (!shop) {
      result.unassigned.push({ name: item.name, quantity: item.quantity, unit: item.unit, kind })
      continue
    }
    let group = groups.get(shop.id)
    if (!group) {
      group = { shop, kind: shop.kind, lines: [] }
      groups.set(shop.id, group)
    }
    const est = estimateLine(
      { ingredientId: item.ingredientId, name: item.name, quantity: item.quantity, unit: item.unit, pricePerUnit: item.pricePerUnit },
      shop.kind,
      shop.priceMemory,
    )
    group.lines.push({
      key: `l${group.lines.length + 1}`,
      sourceItemId: item.id,
      ingredientId: item.ingredientId,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      note: null,
      estimateEur: est.eur,
      estimateSource: est.source,
      volatile: shop.kind === 'pescaderia' && isVolatileFish(item.name),
      quote: null,
      verdict: null,
      reasons: [],
      decision: null,
    })
  }

  result.byShop = [...groups.values()].sort((a, b) => a.shop.position - b.shop.position)
  return result
}

export function sumEstimate(lines: ShopOrderLine[]): number | null {
  const known = lines.filter((l) => l.estimateEur != null)
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
    .filter((l) => l.estimateEur != null && (l.estimateSource === 'manual' || l.estimateSource === 'historial'))
    .reduce((acc, l) => acc + (l.estimateEur as number), 0)
  if (precise / total < 0.5) return null
  return defaultCap(total, lines.some((l) => l.volatile))
}
