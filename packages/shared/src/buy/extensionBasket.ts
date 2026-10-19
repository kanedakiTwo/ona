/**
 * La cesta del súper para la extensión del navegador (specs/shop-orders.md →
 * «Enviar a la extensión del navegador»). Puro: lo usan el borrador (API), la
 * web y, copiando `extensionKey`, la extensión.
 */
import type { BuyableUnit } from '../types/shopping.js'
import type { ShopOrderLine } from '../types/shopOrders.js'
import type { BasketLine, BasketSendResult } from '../types/basketExtension.js'
import { buyRuleByKey, normalizeBuyName } from './convert.js'
import { shoppingGroupOf } from './listGroup.js'

/** «Tomate · varias presentaciones» → «Tomate». */
export function basketBaseName(name: string): string {
  return (name.split(' · ')[0] ?? name).trim()
}

/** Clave de la tabla de productos de una cadena: nombre normalizado + « · » + elección normalizada. */
export function extensionKey(name: string, choice: string | null): string {
  const n = normalizeBuyName(basketBaseName(name))
  return choice ? `${n} · ${normalizeBuyName(choice)}` : n
}

export interface OrderMemberInput {
  id: string
  name: string
  quantity: number
  unit: BuyableUnit
}

export interface OrderMember {
  name: string
  quantity: number
  unit: BuyableUnit
  sourceItemIds: string[]
}

/**
 * Los artículos que junta una línea de pedido, agrupados con el criterio de
 * la lista de la compra (`shoppingGroupOf`). El nombre genérico de la regla
 * (su clave: «leche», «jamon», «alubias») no es un producto aparte: se suma
 * al grupo específico de más cantidad. null = todo es el mismo producto.
 */
export function orderMembers(members: OrderMemberInput[], ruleKey: string | null): OrderMember[] | null {
  if (members.length < 2) return null
  const generic = ruleKey ? normalizeBuyName(ruleKey) : null
  const groups = new Map<string, OrderMember & { generic: boolean }>()
  for (const mem of members) {
    const key = shoppingGroupOf(mem.name).key
    const g = groups.get(key)
    if (g) {
      if (g.unit === mem.unit) g.quantity += mem.quantity
      g.sourceItemIds.push(mem.id)
      continue
    }
    groups.set(key, {
      name: mem.name,
      quantity: mem.quantity,
      unit: mem.unit,
      sourceItemIds: [mem.id],
      generic: generic != null && normalizeBuyName(basketBaseName(mem.name)) === generic,
    })
  }
  const all = [...groups.values()]
  const specific = all.filter((g) => !g.generic)
  if (specific.length < 2) return null
  for (const g of all.filter((x) => x.generic)) {
    const target = specific.reduce((a, b) => (b.quantity > a.quantity ? b : a))
    target.sourceItemIds.push(...g.sourceItemIds)
    if (target.unit === g.unit) target.quantity += g.quantity
  }
  return specific.map(({ generic: _generic, ...rest }) => rest)
}

export function buildExtensionBasket(_lines: ShopOrderLine[]): BasketLine[] {
  return []
}
export function sourceItemsForBasketKey(_lines: ShopOrderLine[], _key: string): string[] {
  return []
}
export function basketMayBeInCart(_r: { anadidas: number; lineas: Array<{ estado: string }> }): boolean {
  return false
}
